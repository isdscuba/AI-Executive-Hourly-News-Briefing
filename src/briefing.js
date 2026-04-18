'use strict';

const { fetchAllTweets } = require('./twitter');
const { stripAllBatches } = require('./transform');
const { getState, saveState } = require('./state');
const { generateBrief } = require('./gemini');
const { sendTelegram } = require('./telegram');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Returns the UTC ISO string for midnight ET today.
 * Handles DST automatically by computing elapsed ms since midnight ET.
 */
function getMidnightEtUtc() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const h = parseInt(parts.find(p => p.type === 'hour').value) % 24;
  const m = parseInt(parts.find(p => p.type === 'minute').value);
  const s = parseInt(parts.find(p => p.type === 'second').value);
  const msFromMidnight = (h * 3600 + m * 60 + s) * 1000;
  return new Date(now.getTime() - msFromMidnight).toISOString();
}

/**
 * Filters stripped tweet batches to only tweets newer than sinceTimestamp.
 * On first run (sinceTimestamp = null), all tweets pass through.
 */
function filterNewTweets(strippedBatches, sinceTimestamp) {
  if (!sinceTimestamp) return strippedBatches;

  const since = new Date(sinceTimestamp);
  const filterBatch = tweets => tweets.filter(t => {
    const d = new Date(t.createdAt);
    return !isNaN(d) && d > since;
  });

  return {
    tweets1: filterBatch(strippedBatches.tweets1),
    tweets2: filterBatch(strippedBatches.tweets2),
    tweets3: filterBatch(strippedBatches.tweets3),
    tweets4: filterBatch(strippedBatches.tweets4),
    tweets5: filterBatch(strippedBatches.tweets5),
  };
}

/**
 * Main pipeline.
 *
 * @param {Object} opts
 * @param {boolean} opts.isOpeningBrief - If true, fetch and filter from midnight ET
 *   instead of the last run timestamp. Used for the 6 AM weekday and 7 AM weekend briefs.
 */
async function runBriefingPipeline({ isOpeningBrief = false } = {}) {
  log(`Starting briefing pipeline${isOpeningBrief ? ' [OPENING BRIEF — midnight window]' : ''}`);

  // For opening brief, use midnight ET as the since timestamp for both
  // the Twitter API query and the client-side tweet filter.
  const midnightEtUtc = isOpeningBrief ? getMidnightEtUtc() : null;

  // Step 1: Fetch tweets
  log(`Fetching tweets (5 batches in parallel, since: ${midnightEtUtc || '1 hour ago'})...`);
  const rawBatches = await fetchAllTweets(midnightEtUtc);

  const rawCounts = [1, 2, 3, 4, 5].map(n => rawBatches[`tweets${n}`].length);
  const rawTotal = rawCounts.reduce((a, b) => a + b, 0);
  log(`Batch 1: ${rawCounts[0]} | Batch 2: ${rawCounts[1]} | Batch 3: ${rawCounts[2]} | Batch 4: ${rawCounts[3]} | Batch 5: ${rawCounts[4]} | Total: ${rawTotal} tweets`);

  // Step 2: Strip to minimal fields (~95% token reduction)
  const rawBytes = Buffer.byteLength(JSON.stringify(rawBatches), 'utf8');
  const stripped = stripAllBatches(rawBatches);
  const strippedBytes = Buffer.byteLength(JSON.stringify(stripped), 'utf8');
  const reductionPct = Math.round((1 - strippedBytes / rawBytes) * 100);
  log(`Payload: ${Math.round(rawBytes / 1024)}KB → ${Math.round(strippedBytes / 1024)}KB after strip (~${reductionPct}% reduction)`);

  // Step 3: Load previous run state
  const { lastRunAt, lastBriefText } = getState();

  // Step 4: Filter to new tweets only
  // Opening brief: filter since midnight ET (ignore lastRunAt — we want all overnight news)
  // Normal run: filter since last run timestamp
  const filterSince = isOpeningBrief ? midnightEtUtc : lastRunAt;
  const newTweets = filterNewTweets(stripped, filterSince);
  const newTotal = Object.values(newTweets).reduce((a, b) => a + b.length, 0);
  log(`New tweets since ${filterSince || 'beginning'}: ${newTotal}`);

  // Step 5: Guard — skip if nothing new
  if (newTotal === 0) {
    log('No new tweets — skipping');
    return;
  }

  // Step 6: Generate brief
  // Pass lastBriefText for story-level dedup even on opening brief
  // (avoids re-reporting the last story from the night before)
  const newBytes = Buffer.byteLength(JSON.stringify(newTweets), 'utf8');
  log(`Sending ${Math.round(newBytes / 1024)}KB to Gemini (${newTotal} tweets, story dedup: ${lastBriefText ? 'yes' : 'first run'})...`);

  let briefText;
  try {
    briefText = await generateBrief(newTweets, lastBriefText);
  } catch (err) {
    log(`Gemini failed (attempt 1): ${err.message}. Retrying in 10s...`);
    await sleep(10_000);
    try {
      briefText = await generateBrief(newTweets, lastBriefText);
    } catch (retryErr) {
      log(`Gemini failed (attempt 2): ${retryErr.message}. Skipping run.`);
      return;
    }
  }
  log(`Brief generated: ${briefText.length} chars`);

  // Hard-cap brief at 3800 chars so oversized outputs don't bloat the
  // story exclusion list passed to the next run.
  const cappedBrief = briefText.length > 3800 ? briefText.substring(0, 3800) : briefText;
  if (cappedBrief.length < briefText.length) {
    log(`Brief truncated from ${briefText.length} to ${cappedBrief.length} chars (hard cap)`);
  }

  // Step 7: Send to Telegram
  log('Sending to Telegram...');
  try {
    const tgResult = await sendTelegram(cappedBrief);
    log(`Telegram OK (message_id: ${tgResult?.result?.message_id})`);
  } catch (err) {
    log(`Telegram failed: ${err.message}. Continuing to save state.`);
  }

  // Step 8: Save state for next run
  try {
    saveState(cappedBrief);
    log('Pipeline complete.');
  } catch (err) {
    log(`State save failed: ${err.message}. Next run will reprocess tweets.`);
  }
}

module.exports = { runBriefingPipeline, filterNewTweets, getMidnightEtUtc };
