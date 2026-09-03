'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../src/config');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json');
const BACKUP_FILE = `${STATE_FILE}.bak`;
const TMP_FILE = `${STATE_FILE}.tmp`;
const MAX_HISTORY = config.history.maxEntries;

const MOCK_TWEETS = {
  tweets1: [{ text: 'A', createdAt: '2026-04-22T18:00:00Z', author: 'u1' }],
  tweets2: [], tweets3: [], tweets4: [], tweets5: [],
};

function cleanup() {
  for (const f of [STATE_FILE, BACKUP_FILE, TMP_FILE]) {
    try { fs.unlinkSync(f); } catch {}
  }
  try { fs.rmdirSync(path.dirname(STATE_FILE)); } catch {}
}

describe('getState', () => {
  beforeEach(() => { cleanup(); jest.resetModules(); });
  afterEach(cleanup);

  it('returns null lastRunAt and empty arrays when state file does not exist (first run)', () => {
    const { getState } = require('../../src/state');
    expect(getState()).toEqual({ lastRunAt: null, recentBriefs: [], recentTweets: [] });
  });

  it('returns stored lastRunAt, recentBriefs, and recentTweets', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      lastRunAt: '2026-03-31T18:00:00.000Z',
      recentBriefs: ['Brief 1', 'Brief 2'],
      recentTweets: [MOCK_TWEETS],
    }), 'utf8');
    const { getState } = require('../../src/state');
    const state = getState();
    expect(state.lastRunAt).toBe('2026-03-31T18:00:00.000Z');
    expect(state.recentBriefs).toEqual(['Brief 1', 'Brief 2']);
    expect(state.recentTweets).toEqual([MOCK_TWEETS]);
  });

  it('migrates old schema: lastBriefText string becomes recentBriefs[0]', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      lastRunAt: '2026-03-31T18:00:00.000Z',
      lastBriefText: 'Old brief text',
    }), 'utf8');
    const { getState } = require('../../src/state');
    const state = getState();
    expect(state.recentBriefs).toEqual(['Old brief text']);
    expect(state.recentTweets).toEqual([]);
  });

  it('returns null lastRunAt and empty arrays when file contains invalid JSON', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, 'not json', 'utf8');
    const { getState } = require('../../src/state');
    expect(getState()).toEqual({ lastRunAt: null, recentBriefs: [], recentTweets: [] });
  });

  it('returns empty arrays for missing recentBriefs/recentTweets fields', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastRunAt: '2026-03-31T18:00:00.000Z' }), 'utf8');
    const { getState } = require('../../src/state');
    const state = getState();
    expect(state.recentBriefs).toEqual([]);
    expect(state.recentTweets).toEqual([]);
  });

  it('falls back to the .bak file when state.json is missing', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(BACKUP_FILE, JSON.stringify({
      lastRunAt: '2026-03-31T18:00:00.000Z',
      recentBriefs: ['Backup brief'],
      recentTweets: [MOCK_TWEETS],
    }), 'utf8');
    const { getState } = require('../../src/state');
    const state = getState();
    expect(state.lastRunAt).toBe('2026-03-31T18:00:00.000Z');
    expect(state.recentBriefs).toEqual(['Backup brief']);
  });

  it('falls back to the .bak file when state.json is corrupt', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, 'not json', 'utf8');
    fs.writeFileSync(BACKUP_FILE, JSON.stringify({
      lastRunAt: '2026-03-31T18:00:00.000Z',
      recentBriefs: ['Backup brief'],
      recentTweets: [],
    }), 'utf8');
    const { getState } = require('../../src/state');
    const state = getState();
    expect(state.recentBriefs).toEqual(['Backup brief']);
  });

  it('starts fresh when both state.json and .bak are missing', () => {
    const { getState } = require('../../src/state');
    expect(getState()).toEqual({ lastRunAt: null, recentBriefs: [], recentTweets: [] });
  });
});

describe('saveState', () => {
  beforeEach(() => { cleanup(); jest.resetModules(); });
  afterEach(cleanup);

  it('creates the data directory if it does not exist', () => {
    const { saveState } = require('../../src/state');
    saveState('Test brief', MOCK_TWEETS);
    expect(fs.existsSync(path.dirname(STATE_FILE))).toBe(true);
  });

  it('writes a valid ISO timestamp to lastRunAt', () => {
    const { saveState } = require('../../src/state');
    saveState('Test brief', MOCK_TWEETS);
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(new Date(data.lastRunAt).toISOString()).toBe(data.lastRunAt);
  });

  it('writes brief as first entry in recentBriefs', () => {
    const { saveState } = require('../../src/state');
    saveState('My brief content', MOCK_TWEETS);
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.recentBriefs[0]).toBe('My brief content');
  });

  it('writes tweet batches as first entry in recentTweets', () => {
    const { saveState } = require('../../src/state');
    saveState('Brief', MOCK_TWEETS);
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.recentTweets[0]).toEqual(MOCK_TWEETS);
  });

  it(`rolls briefs with newest first, capped at ${MAX_HISTORY}`, () => {
    const { saveState } = require('../../src/state');
    for (let i = 1; i <= MAX_HISTORY + 1; i++) saveState(`Brief ${i}`, MOCK_TWEETS);
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.recentBriefs).toHaveLength(MAX_HISTORY);
    expect(data.recentBriefs[0]).toBe(`Brief ${MAX_HISTORY + 1}`);
    expect(data.recentBriefs[MAX_HISTORY - 1]).toBe('Brief 2');
  });

  it(`rolls tweet sets with newest first, capped at ${MAX_HISTORY}`, () => {
    const { saveState } = require('../../src/state');
    const batch = (n) => ({ tweets1: [{ text: `t${n}` }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] });
    for (let i = 1; i <= MAX_HISTORY + 1; i++) saveState(`b${i}`, batch(i));
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.recentTweets).toHaveLength(MAX_HISTORY);
    expect(data.recentTweets[0].tweets1[0].text).toBe(`t${MAX_HISTORY + 1}`);
    expect(data.recentTweets[MAX_HISTORY - 1].tweets1[0].text).toBe('t2');
  });

  it('can be read back correctly via getState', () => {
    const { saveState, getState } = require('../../src/state');
    saveState('Round-trip test', MOCK_TWEETS);
    const state = getState();
    expect(state.recentBriefs[0]).toBe('Round-trip test');
    expect(state.recentTweets[0]).toEqual(MOCK_TWEETS);
    expect(state.lastRunAt).not.toBeNull();
  });

  it('does not leave a .tmp file behind after a successful save', () => {
    const { saveState } = require('../../src/state');
    saveState('Test brief', MOCK_TWEETS);
    expect(fs.existsSync(TMP_FILE)).toBe(false);
  });

  it('writes the pre-save state.json to .bak before replacing it', () => {
    const { saveState } = require('../../src/state');
    saveState('First brief', MOCK_TWEETS);
    saveState('Second brief', MOCK_TWEETS);
    const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    const current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(backup.recentBriefs[0]).toBe('First brief');
    expect(current.recentBriefs[0]).toBe('Second brief');
  });

  it('does not write a .bak file on the very first save (nothing to back up)', () => {
    const { saveState } = require('../../src/state');
    saveState('First brief', MOCK_TWEETS);
    expect(fs.existsSync(BACKUP_FILE)).toBe(false);
  });
});
