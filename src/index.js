'use strict';

const cron = require('node-cron');
const config = require('./config');
const { runBriefingPipeline } = require('./briefing');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

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

log('Exec News Briefing daemon started');
log(`Weekday: every hour ${config.schedule.weekday.start}:00–${config.schedule.weekday.end}:00 ET`);
log(`Weekend: every ${config.schedule.weekend.intervalHours}h ${config.schedule.weekend.start}:00–${config.schedule.weekend.end}:00 ET`);
