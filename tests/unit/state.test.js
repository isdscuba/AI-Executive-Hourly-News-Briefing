'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json');

const MOCK_TWEETS = {
  tweets1: [{ text: 'A', createdAt: '2026-04-22T18:00:00Z', author: 'u1' }],
  tweets2: [], tweets3: [], tweets4: [], tweets5: [],
};

function cleanup() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
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

  it('rolls briefs with newest first, capped at 3', () => {
    const { saveState } = require('../../src/state');
    saveState('Brief 1', MOCK_TWEETS);
    saveState('Brief 2', MOCK_TWEETS);
    saveState('Brief 3', MOCK_TWEETS);
    saveState('Brief 4', MOCK_TWEETS);
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.recentBriefs).toHaveLength(3);
    expect(data.recentBriefs[0]).toBe('Brief 4');
    expect(data.recentBriefs[2]).toBe('Brief 2');
  });

  it('rolls tweet sets with newest first, capped at 3', () => {
    const { saveState } = require('../../src/state');
    const batch = (n) => ({ tweets1: [{ text: `t${n}` }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] });
    saveState('b1', batch(1));
    saveState('b2', batch(2));
    saveState('b3', batch(3));
    saveState('b4', batch(4));
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.recentTweets).toHaveLength(3);
    expect(data.recentTweets[0].tweets1[0].text).toBe('t4');
    expect(data.recentTweets[2].tweets1[0].text).toBe('t2');
  });

  it('can be read back correctly via getState', () => {
    const { saveState, getState } = require('../../src/state');
    saveState('Round-trip test', MOCK_TWEETS);
    const state = getState();
    expect(state.recentBriefs[0]).toBe('Round-trip test');
    expect(state.recentTweets[0]).toEqual(MOCK_TWEETS);
    expect(state.lastRunAt).not.toBeNull();
  });
});
