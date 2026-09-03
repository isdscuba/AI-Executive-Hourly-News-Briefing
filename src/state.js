'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');
const BACKUP_FILE = `${STATE_FILE}.bak`;
const TMP_FILE = `${STATE_FILE}.tmp`;

function parseStateFile(raw) {
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
}

/**
 * Returns { lastRunAt, recentBriefs, recentTweets } from the state file.
 * recentBriefs: string[] of last N briefs (newest first), empty array on first run.
 * recentTweets: tweet-batch objects[] of last N runs (newest first), empty array on first run.
 * Migrates old schema (lastBriefText: string) to new schema automatically.
 *
 * If the primary file is missing or unreadable, falls back to the rolling
 * .bak copy written by the previous saveState() call — see saveState() for
 * why: state.json disappeared without any code path or external tool (git,
 * Synology, cron, other launchd agents) accounting for it on 2026-09-03, so
 * this makes a repeat of that survivable instead of silently discarding up
 * to config.history.maxEntries runs of dedup/story-exclusion context.
 */
function getState() {
  try {
    return parseStateFile(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[state] Failed to read state file:', err.message);
    }

    try {
      const backup = parseStateFile(fs.readFileSync(BACKUP_FILE, 'utf8'));
      console.error(`[state] ${STATE_FILE} missing/unreadable — recovered from ${BACKUP_FILE} (lastRunAt: ${backup.lastRunAt})`);
      return backup;
    } catch (backupErr) {
      if (backupErr.code !== 'ENOENT') {
        console.error('[state] Backup file also failed to read:', backupErr.message);
      } else if (err.code !== 'ENOENT') {
        // Primary was corrupt (not just absent) and there's no backup to fall back to.
        console.error('[state] No backup available — starting fresh');
      }
      return { lastRunAt: null, recentBriefs: [], recentTweets: [] };
    }
  }
}

/**
 * Saves the run timestamp, generated brief, and tweet batches for the next run.
 * Prepends to rolling arrays (max config.history.maxEntries entries each, newest first).
 *
 * Writes are atomic (write to a temp file, then rename over the target) so a
 * crash mid-write can't leave a truncated/corrupt state.json. The previous
 * state.json is preserved as state.json.bak before being replaced, so a
 * single lost or corrupted write only costs one run of history instead of
 * all of it — see getState()'s backup fallback.
 */
function saveState(briefText, tweetBatches) {
  const dataDir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const existing = getState();
  const recentBriefs = [briefText, ...existing.recentBriefs].slice(0, config.history.maxEntries);
  const recentTweets = [tweetBatches, ...existing.recentTweets].slice(0, config.history.maxEntries);

  fs.writeFileSync(TMP_FILE, JSON.stringify({
    lastRunAt: new Date().toISOString(),
    recentBriefs,
    recentTweets,
  }, null, 2), 'utf8');

  try {
    fs.copyFileSync(STATE_FILE, BACKUP_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[state] Failed to write backup copy (continuing):', err.message);
    }
  }

  fs.renameSync(TMP_FILE, STATE_FILE);
}

module.exports = { getState, saveState };
