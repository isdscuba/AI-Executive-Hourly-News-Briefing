'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

/**
 * Returns { lastRunAt, lastBriefText } from the state file.
 * Returns { lastRunAt: null, lastBriefText: null } on first run.
 */
function getState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastRunAt: parsed?.lastRunAt || null,
      lastBriefText: parsed?.lastBriefText || null,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[state] Failed to read state file:', err.message);
    }
    return { lastRunAt: null, lastBriefText: null };
  }
}

/**
 * Saves the run timestamp and the generated brief text for the next run.
 */
function saveState(briefText) {
  const dataDir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    lastRunAt: new Date().toISOString(),
    lastBriefText: briefText,
  }, null, 2), 'utf8');
}

module.exports = { getState, saveState };
