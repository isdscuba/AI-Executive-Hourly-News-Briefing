'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('./config');
const { runBriefingPipeline } = require('./briefing');
const { sendTelegram } = require('./telegram');
const { getState } = require('./state');

// On the LOCAL drive so crash reasons survive an external drive unmount
const CRASH_LOG = path.join(process.env.HOME || '/tmp', 'Library/Logs/exec-briefing/crash.log');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Persist crash reason across restarts (launchd truncates stderr on each start)
process.on('uncaughtException', err => {
  const msg = `[${new Date().toISOString()}] CRASH uncaughtException: ${err.stack}\n`;
  try { fs.appendFileSync(CRASH_LOG, msg); } catch (_) {}
  console.error(msg);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  const msg = `[${new Date().toISOString()}] CRASH unhandledRejection: ${reason?.stack || reason}\n`;
  try { fs.appendFileSync(CRASH_LOG, msg); } catch (_) {}
  console.error(msg);
  process.exit(1);
});
// Log clean kills so we can distinguish OS signals from crashes
process.on('SIGTERM', () => {
  const msg = `[${new Date().toISOString()}] Received SIGTERM — exiting\n`;
  try { fs.appendFileSync(CRASH_LOG, msg); } catch (_) {}
  process.exit(0);
});
process.on('SIGHUP', () => {
  const msg = `[${new Date().toISOString()}] Received SIGHUP — exiting\n`;
  try { fs.appendFileSync(CRASH_LOG, msg); } catch (_) {}
  process.exit(0);
});

/**
 * Returns current ET hour (0–23) and whether it is a weekend day.
 * Uses Intl.DateTimeFormat to handle DST automatically.
 */
function getEtDateParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.schedule.timezone,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find(p => p.type === 'hour').value) % 24;
  const weekday = parts.find(p => p.type === 'weekday').value; // 'Sat' | 'Sun' | ...
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  return { hour, isWeekend };
}

/**
 * Returns true if the given ET hour is a scheduled run hour.
 * Mirrors the gate logic in the cron callback.
 */
function isScheduledHour(etHour, isWeekend) {
  const schedule = isWeekend ? config.schedule.weekend : config.schedule.weekday;
  if (etHour < schedule.start || etHour > schedule.end) return false;
  if (isWeekend && (etHour - schedule.start) % schedule.intervalHours !== 0) return false;
  return true;
}

// Runs every hour on the hour; internal logic gates on weekday vs weekend schedule.
cron.schedule('0 * * * *', async () => {
  const { hour: etHour, isWeekend } = getEtDateParts();
  const schedule = isWeekend ? config.schedule.weekend : config.schedule.weekday;

  // Bounds check
  if (etHour < schedule.start || etHour > schedule.end) {
    log(`Outside run window (ET hour: ${etHour}, ${isWeekend ? 'weekend' : 'weekday'}) — skipping`);
    return;
  }

  // Weekend: only run on the 2-hour interval (7, 9, 11, ..., 23)
  if (isWeekend && (etHour - schedule.start) % schedule.intervalHours !== 0) {
    log(`Weekend off-interval (ET hour: ${etHour}) — skipping`);
    return;
  }

  const isOpeningBrief = etHour === schedule.openingHour;

  log(`Running pipeline (ET hour: ${etHour}, ${isWeekend ? 'weekend' : 'weekday'}${isOpeningBrief ? ', OPENING BRIEF' : ''})`);

  await runBriefingPipeline({ isOpeningBrief }).catch(err => {
    console.error(`[${new Date().toISOString()}] Unhandled pipeline error:`, err);
  });
}, { timezone: config.schedule.timezone });

/**
 * On startup: send a Telegram alert if the service restarted unexpectedly
 * (i.e. lastRunAt was recent — indicates a crash, not a cold boot).
 * Throttled: only fires if last run was within 6 hours to avoid noise on
 * machine reboots after a long idle period.
 */
async function notifyStartup() {
  const { lastRunAt } = getState();
  if (!lastRunAt) return;
  const minutesAgo = Math.round((Date.now() - new Date(lastRunAt).getTime()) / 60000);
  if (minutesAgo > 360) return; // >6 hours = cold boot, not a crash restart
  await sendTelegram(`⚠️ exec-news restarted (last run: ${minutesAgo}m ago)`).catch(e => {
    log(`Startup alert failed: ${e.message}`);
  });
}

/**
 * On startup: if we're currently in a scheduled run window and lastRunAt is
 * >70 minutes ago, the service missed the top-of-hour fire (crash mid-window).
 * Run the pipeline immediately to catch up.
 */
async function catchUpIfMissedRun() {
  const { hour: etHour, isWeekend } = getEtDateParts();
  if (!isScheduledHour(etHour, isWeekend)) return;

  const { lastRunAt } = getState();
  const minutesSinceLast = lastRunAt
    ? (Date.now() - new Date(lastRunAt).getTime()) / 60000
    : Infinity;

  if (minutesSinceLast <= 70) return; // ran recently enough, no catch-up needed

  const schedule = isWeekend ? config.schedule.weekend : config.schedule.weekday;
  const isOpeningBrief = etHour === schedule.openingHour;
  log(`Startup catch-up: missed ET hour ${etHour} (last run ${Math.round(minutesSinceLast)}m ago) — running now`);
  await runBriefingPipeline({ isOpeningBrief }).catch(err => {
    console.error(`[${new Date().toISOString()}] Catch-up pipeline error:`, err);
  });
}

log('Exec News Briefing daemon started');
log(`Weekday: every hour ${config.schedule.weekday.start}:00–${config.schedule.weekday.end}:00 ET`);
log(`Weekend: every ${config.schedule.weekend.intervalHours}h ${config.schedule.weekend.start}:00–${config.schedule.weekend.end}:00 ET`);

// Run startup tasks sequentially (alert first, then catch-up)
notifyStartup().then(() => catchUpIfMissedRun()).catch(err => {
  console.error(`[${new Date().toISOString()}] Startup task error:`, err);
});
