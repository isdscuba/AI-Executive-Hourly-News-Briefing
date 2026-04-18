'use strict';

jest.mock('../../src/twitter');
jest.mock('../../src/transform');
jest.mock('../../src/state');
jest.mock('../../src/gemini');
jest.mock('../../src/telegram');

const { fetchAllTweets } = require('../../src/twitter');
const { stripAllBatches } = require('../../src/transform');
const { getState, saveState } = require('../../src/state');
const { generateBrief } = require('../../src/gemini');
const { sendTelegram } = require('../../src/telegram');
const { runBriefingPipeline, filterNewTweets } = require('../../src/briefing');

const MOCK_RAW = {
  tweets1: [{ text: 'T1', createdAt: 'Thu Apr 02 18:00:00 +0000 2026', author: { userName: 'u1' } }],
  tweets2: [{ text: 'T2', createdAt: 'Thu Apr 02 18:01:00 +0000 2026', author: { userName: 'u2' } }],
  tweets3: [], tweets4: [], tweets5: [],
};

const MOCK_STRIPPED = {
  tweets1: [{ text: 'T1', createdAt: 'Thu Apr 02 18:00:00 +0000 2026', author: 'u1' }],
  tweets2: [{ text: 'T2', createdAt: 'Thu Apr 02 18:01:00 +0000 2026', author: 'u2' }],
  tweets3: [], tweets4: [], tweets5: [],
};

const MOCK_BRIEF = '🚨 URGENT DEVELOPMENTS:\n🚨 Test item\n\n📈 MARKETS\nMarket item';
const MOCK_PREV_BRIEF = 'Previous hour brief text';

function setupHappyPath({ lastRunAt = null, lastBriefText = null } = {}) {
  fetchAllTweets.mockResolvedValue(MOCK_RAW);
  stripAllBatches.mockReturnValue(MOCK_STRIPPED);
  getState.mockReturnValue({ lastRunAt, lastBriefText });
  generateBrief.mockResolvedValue(MOCK_BRIEF);
  sendTelegram.mockResolvedValue({ ok: true, result: { message_id: 42 } });
  saveState.mockImplementation(() => {});
}

describe('filterNewTweets', () => {
  const batches = {
    tweets1: [
      { text: 'old', createdAt: 'Thu Apr 02 17:00:00 +0000 2026', author: 'u1' },
      { text: 'new', createdAt: 'Thu Apr 02 18:30:00 +0000 2026', author: 'u2' },
    ],
    tweets2: [], tweets3: [], tweets4: [], tweets5: [],
  };

  it('returns all tweets when sinceTimestamp is null (first run)', () => {
    expect(filterNewTweets(batches, null).tweets1).toHaveLength(2);
  });

  it('filters out tweets at or before sinceTimestamp', () => {
    const result = filterNewTweets(batches, '2026-04-02T18:00:00.000Z');
    expect(result.tweets1).toHaveLength(1);
    expect(result.tweets1[0].text).toBe('new');
  });

  it('returns empty when all tweets are older than sinceTimestamp', () => {
    expect(filterNewTweets(batches, '2026-04-02T19:00:00.000Z').tweets1).toHaveLength(0);
  });

  it('excludes tweets with unparseable createdAt', () => {
    const b = { tweets1: [{ text: 'bad', createdAt: 'not-a-date', author: 'u' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] };
    expect(filterNewTweets(b, '2026-04-02T18:00:00.000Z').tweets1).toHaveLength(0);
  });
});

describe('runBriefingPipeline — happy path', () => {
  beforeEach(() => setupHappyPath());

  it('calls all pipeline steps in order', async () => {
    const order = [];
    fetchAllTweets.mockImplementation(async () => { order.push('fetch'); return MOCK_RAW; });
    stripAllBatches.mockImplementation(() => { order.push('strip'); return MOCK_STRIPPED; });
    getState.mockImplementation(() => { order.push('getState'); return { lastRunAt: null, lastBriefText: null }; });
    generateBrief.mockImplementation(async () => { order.push('gemini'); return MOCK_BRIEF; });
    sendTelegram.mockImplementation(async () => { order.push('telegram'); return { ok: true }; });
    saveState.mockImplementation(() => { order.push('save'); });

    await runBriefingPipeline();
    expect(order).toEqual(['fetch', 'strip', 'getState', 'gemini', 'telegram', 'save']);
  });

  it('passes lastBriefText from state to generateBrief', async () => {
    setupHappyPath({ lastRunAt: null, lastBriefText: MOCK_PREV_BRIEF });
    await runBriefingPipeline();
    expect(generateBrief).toHaveBeenCalledWith(expect.any(Object), MOCK_PREV_BRIEF);
  });

  it('passes null lastBriefText on first run', async () => {
    setupHappyPath({ lastRunAt: null, lastBriefText: null });
    await runBriefingPipeline();
    expect(generateBrief).toHaveBeenCalledWith(expect.any(Object), null);
  });

  it('calls saveState with the generated brief text', async () => {
    await runBriefingPipeline();
    expect(saveState).toHaveBeenCalledWith(MOCK_BRIEF);
  });
});

describe('runBriefingPipeline — tweet filtering', () => {
  it('skips run when all tweets are older than lastRunAt', async () => {
    fetchAllTweets.mockResolvedValue(MOCK_RAW);
    stripAllBatches.mockReturnValue(MOCK_STRIPPED);
    // last run AFTER all mock tweet timestamps
    getState.mockReturnValue({ lastRunAt: '2026-04-02T19:00:00.000Z', lastBriefText: MOCK_PREV_BRIEF });
    generateBrief.mockResolvedValue(MOCK_BRIEF);
    sendTelegram.mockResolvedValue({ ok: true });
    saveState.mockImplementation(() => {});

    await runBriefingPipeline();
    expect(generateBrief).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});

describe('runBriefingPipeline — empty tweets guard', () => {
  it('skips when all batches are empty', async () => {
    const empty = { tweets1: [], tweets2: [], tweets3: [], tweets4: [], tweets5: [] };
    fetchAllTweets.mockResolvedValue(empty);
    stripAllBatches.mockReturnValue(empty);
    getState.mockReturnValue({ lastRunAt: null, lastBriefText: null });
    generateBrief.mockResolvedValue(MOCK_BRIEF);
    sendTelegram.mockResolvedValue({ ok: true });
    saveState.mockImplementation(() => {});

    await runBriefingPipeline();
    expect(generateBrief).not.toHaveBeenCalled();
    await expect(runBriefingPipeline()).resolves.toBeUndefined();
  });
});

describe('runBriefingPipeline — Gemini retry', () => {
  beforeEach(() => { setupHappyPath(); jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  it('retries once after first Gemini failure', async () => {
    generateBrief.mockRejectedValueOnce(new Error('Quota')).mockResolvedValueOnce(MOCK_BRIEF);
    const p = runBriefingPipeline();
    await jest.runAllTimersAsync();
    await p;
    expect(generateBrief).toHaveBeenCalledTimes(2);
    expect(sendTelegram).toHaveBeenCalled();
  });

  it('skips run and does not save state if both Gemini attempts fail', async () => {
    generateBrief.mockRejectedValue(new Error('Down'));
    const p = runBriefingPipeline();
    await jest.runAllTimersAsync();
    await p;
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });
});

describe('runBriefingPipeline — resilience', () => {
  beforeEach(() => setupHappyPath());

  it('still saves state after Telegram failure', async () => {
    sendTelegram.mockRejectedValue(new Error('429'));
    await runBriefingPipeline();
    expect(saveState).toHaveBeenCalledWith(MOCK_BRIEF);
  });

  it('does not throw when Telegram fails', async () => {
    sendTelegram.mockRejectedValue(new Error('429'));
    await expect(runBriefingPipeline()).resolves.toBeUndefined();
  });

  it('does not throw when saveState fails', async () => {
    saveState.mockImplementation(() => { throw new Error('Disk full'); });
    await expect(runBriefingPipeline()).resolves.toBeUndefined();
  });
});
