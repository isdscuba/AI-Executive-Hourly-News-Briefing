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
 * Returns current ET hour (0–23).
 * Uses Intl.DateTimeFormat to handle DST automatically.
 */
function getEtDateParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.schedule.timezone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find(p => p.type === 'hour').value) % 24;
  return { hour };
}

/**
 * Returns true if the given ET hour is a scheduled run hour.
 * Mirrors the gate logic in the cron callback.
 */
function isScheduledHour(etHour) {
  const schedule = config.schedule.daily;
  if (etHour < schedule.start || etHour > schedule.end) return false;
  if ((etHour - schedule.start) % schedule.intervalHours !== 0) return false;
  return true;
}

// Runs every hour on the hour; internal logic gates on the daily schedule.
cron.schedule('0 * * * *', async () => {
  const { hour: etHour } = getEtDateParts();
  const schedule = config.schedule.daily;

  // Bounds check
  if (etHour < schedule.start || etHour > schedule.end) {
    log(`Outside run window (ET hour: ${etHour}) — skipping`);
    return;
  }

  // Only run on the interval (7, 9, 11, ..., 23)
  if ((etHour - schedule.start) % schedule.intervalHours !== 0) {
    log(`Off-interval (ET hour: ${etHour}) — skipping`);
    return;
  }

  const isOpeningBrief = etHour === schedule.openingHour;

  log(`Running pipeline (ET hour: ${etHour}${isOpeningBrief ? ', OPENING BRIEF' : ''})`);

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
  const { hour: etHour } = getEtDateParts();
  if (!isScheduledHour(etHour)) return;

  const { lastRunAt } = getState();
  const minutesSinceLast = lastRunAt
    ? (Date.now() - new Date(lastRunAt).getTime()) / 60000
    : Infinity;

  if (minutesSinceLast <= 70) return; // ran recently enough, no catch-up needed

  const schedule = config.schedule.daily;
  const isOpeningBrief = etHour === schedule.openingHour;
  log(`Startup catch-up: missed ET hour ${etHour} (last run ${Math.round(minutesSinceLast)}m ago) — running now`);
  await runBriefingPipeline({ isOpeningBrief }).catch(err => {
    console.error(`[${new Date().toISOString()}] Catch-up pipeline error:`, err);
  });
}

log('Exec News Briefing daemon started');
log(`Every day: every ${config.schedule.daily.intervalHours}h ${config.schedule.daily.start}:00–${config.schedule.daily.end}:00 ET`);

// Run startup tasks sequentially (alert first, then catch-up)
notifyStartup().then(() => catchUpIfMissedRun()).catch(err => {
  console.error(`[${new Date().toISOString()}] Startup task error:`, err);
});
