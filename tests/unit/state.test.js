'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json');

function cleanup() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
  try { fs.rmdirSync(path.dirname(STATE_FILE)); } catch {}
}

describe('getState', () => {
  beforeEach(() => { cleanup(); jest.resetModules(); });
  afterEach(cleanup);

  it('returns null fields when state file does not exist (first run)', () => {
    const { getState } = require('../../src/state');
    expect(getState()).toEqual({ lastRunAt: null, lastBriefText: null });
  });

  it('returns stored lastRunAt and lastBriefText', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      lastRunAt: '2026-03-31T18:00:00.000Z',
      lastBriefText: 'Previous brief content',
    }), 'utf8');
    const { getState } = require('../../src/state');
    const state = getState();
    expect(state.lastRunAt).toBe('2026-03-31T18:00:00.000Z');
    expect(state.lastBriefText).toBe('Previous brief content');
  });

  it('returns null fields when file contains invalid JSON', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, 'not json', 'utf8');
    const { getState } = require('../../src/state');
    expect(getState()).toEqual({ lastRunAt: null, lastBriefText: null });
  });

  it('returns null for missing fields gracefully', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ someOtherField: 'x' }), 'utf8');
    const { getState } = require('../../src/state');
    expect(getState()).toEqual({ lastRunAt: null, lastBriefText: null });
  });
});

describe('saveState', () => {
  beforeEach(() => { cleanup(); jest.resetModules(); });
  afterEach(cleanup);

  it('creates the data directory if it does not exist', () => {
    const { saveState } = require('../../src/state');
    saveState('Test brief');
    expect(fs.existsSync(path.dirname(STATE_FILE))).toBe(true);
  });

  it('writes a valid ISO timestamp to lastRunAt', () => {
    const { saveState } = require('../../src/state');
    saveState('Test brief');
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(new Date(data.lastRunAt).toISOString()).toBe(data.lastRunAt);
  });

  it('writes the brief text to lastBriefText', () => {
    const { saveState } = require('../../src/state');
    saveState('My brief content');
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.lastBriefText).toBe('My brief content');
  });

  it('overwrites the previous state on subsequent saves', () => {
    const { saveState } = require('../../src/state');
    saveState('First brief');
    saveState('Second brief');
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(data.lastBriefText).toBe('Second brief');
  });

  it('can be read back correctly via getState', () => {
    const { saveState, getState } = require('../../src/state');
    saveState('Round-trip test');
    const state = getState();
    expect(state.lastBriefText).toBe('Round-trip test');
    expect(state.lastRunAt).not.toBeNull();
  });
});
