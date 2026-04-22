'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');
const MAX_HISTORY = 3;

/**
 * Returns { lastRunAt, recentBriefs, recentTweets } from the state file.
 * recentBriefs: string[] of last N briefs (newest first), empty array on first run.
 * recentTweets: tweet-batch objects[] of last N runs (newest first), empty array on first run.
 * Migrates old schema (lastBriefText: string) to new schema automatically.
 */
function getState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    let recentBriefs = parsed?.recentBriefs;
    if (!Array.isArray(recentBriefs)) {
      recentBriefs = parsed?.lastBriefText ? [parsed.lastBriefText] : [];
    }

    const recentTweets = Array.isArray(parsed?.recentTweets) ? parsed.recentTweets : [];

    return {
      lastRunAt: parsed?.lastRunAt || null,
      recentBriefs,
      recentTweets,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[state] Failed to read state file:', err.message);
    }
    return { lastRunAt: null, recentBriefs: [], recentTweets: [] };
  }
}

/**
 * Saves the run timestamp, generated brief, and tweet batches for the next run.
 * Prepends to rolling arrays (max MAX_HISTORY entries each, newest first).
 */
function saveState(briefText, tweetBatches) {
  const dataDir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const existing = getState();
  const recentBriefs = [briefText, ...existing.recentBriefs].slice(0, MAX_HISTORY);
  const recentTweets = [tweetBatches, ...existing.recentTweets].slice(0, MAX_HISTORY);

  fs.writeFileSync(STATE_FILE, JSON.stringify({
    lastRunAt: new Date().toISOString(),
    recentBriefs,
    recentTweets,
  }, null, 2), 'utf8');
}

module.exports = { getState, saveState };
