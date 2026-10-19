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
const { runBriefingPipeline, filterNewTweets, dedupeAgainstRecentTweets } = require('../../src/briefing');

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

function setupHappyPath({ lastRunAt = null, recentBriefs = [], recentTweets = [] } = {}) {
  fetchAllTweets.mockResolvedValue(MOCK_RAW);
  stripAllBatches.mockReturnValue(MOCK_STRIPPED);
  getState.mockReturnValue({ lastRunAt, recentBriefs, recentTweets });
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

describe('dedupeAgainstRecentTweets', () => {
  const batches = {
    tweets1: [{ text: 'seen before', author: 'u1' }, { text: 'brand new', author: 'u2' }],
    tweets2: [], tweets3: [], tweets4: [], tweets5: [],
  };

  const recentTweets = [
    { tweets1: [{ text: 'seen before', author: 'u1' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
  ];

  it('returns all tweets when recentTweets is empty', () => {
    expect(dedupeAgainstRecentTweets(batches, []).tweets1).toHaveLength(2);
  });

  it('filters out tweets whose text was seen in a recent run', () => {
    const result = dedupeAgainstRecentTweets(batches, recentTweets);
    expect(result.tweets1).toHaveLength(1);
    expect(result.tweets1[0].text).toBe('brand new');
  });

  it('dedupes across multiple recent tweet sets', () => {
    const recent = [
      { tweets1: [{ text: 'seen before', author: 'u1' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      { tweets1: [], tweets2: [{ text: 'brand new', author: 'u2' }], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(batches, recent);
    expect(result.tweets1).toHaveLength(0);
  });

  it('preserves tweets not seen in any recent run', () => {
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'truly new' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recentTweets
    );
    expect(result.tweets1).toHaveLength(1);
  });

  it('catches a URL-variant duplicate (same story, different t.co link)', () => {
    const recent = [
      { tweets1: [{ text: 'Markets rally after Fed decision https://t.co/abc123' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'Markets rally after Fed decision https://t.co/xyz999' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recent
    );
    expect(result.tweets1).toHaveLength(0);
  });

  it('catches an RT-prefixed duplicate', () => {
    const recent = [
      { tweets1: [{ text: 'Breaking: central bank raises rates' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'RT @someuser: Breaking: central bank raises rates' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recent
    );
    expect(result.tweets1).toHaveLength(0);
  });

  it('collapses a near-duplicate paraphrase above the Jaccard threshold', () => {
    const recent = [
      { tweets1: [{ text: 'large explosion reported near central train station in downtown area sources say blast was reported' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'large explosion reported near central train station in downtown area sources say blast was confirmed' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recent
    );
    expect(result.tweets1).toHaveLength(0);
  });

  it('keeps a distinct update below the Jaccard threshold (guards against over-collapsing)', () => {
    const recent = [
      { tweets1: [{ text: 'Officials confirm explosion near the capital city border region' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'Death toll from the border region explosion rises to 12, officials say' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recent
    );
    expect(result.tweets1).toHaveLength(1);
  });

  it('collapses a shared-article duplicate across accounts via canonical URL, despite different commentary', () => {
    const recent = [
      { tweets1: [{ text: 'Breaking: major development', url: 'https://example.com/story?utm_source=twitter' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'This is a big deal, everyone should read this', url: 'https://example.com/story' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recent
    );
    expect(result.tweets1).toHaveLength(0);
  });

  it('drops an exact tweet-id repost even when the text differs', () => {
    const recent = [
      { tweets1: [{ text: 'Original wording of the tweet', id: 'abc123' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
    ];
    const result = dedupeAgainstRecentTweets(
      { tweets1: [{ text: 'Edited/re-fetched wording of the same tweet', id: 'abc123' }], tweets2: [], tweets3: [], tweets4: [], tweets5: [] },
      recent
    );
    expect(result.tweets1).toHaveLength(0);
  });

  it('collapses near-duplicates posted across different batches within the same run', () => {
    const result = dedupeAgainstRecentTweets(
      {
        tweets1: [{ text: 'large explosion reported near central train station in downtown area sources say blast was reported', author: 'acct1' }],
        tweets2: [{ text: 'large explosion reported near central train station in downtown area sources say blast was confirmed', author: 'acct2' }],
        tweets3: [], tweets4: [], tweets5: [],
      },
      []
    );
    const total = Object.values(result).reduce((a, b) => a + b.length, 0);
    expect(total).toBe(1);
  });
});

describe('runBriefingPipeline — happy path', () => {
  beforeEach(() => setupHappyPath());

  it('calls all pipeline steps in order', async () => {
    const order = [];
    fetchAllTweets.mockImplementation(async () => { order.push('fetch'); return MOCK_RAW; });
    stripAllBatches.mockImplementation(() => { order.push('strip'); return MOCK_STRIPPED; });
    getState.mockImplementation(() => { order.push('getState'); return { lastRunAt: null, recentBriefs: [], recentTweets: [] }; });
    generateBrief.mockImplementation(async () => { order.push('gemini'); return MOCK_BRIEF; });
    sendTelegram.mockImplementation(async () => { order.push('telegram'); return { ok: true }; });
    saveState.mockImplementation(() => { order.push('save'); });

    await runBriefingPipeline();
    expect(order).toEqual(['getState', 'fetch', 'strip', 'gemini', 'telegram', 'save']);
  });

  it('calls generateBrief with the deduped tweet batches', async () => {
    await runBriefingPipeline();
    expect(generateBrief).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
  });

  it('calls saveState with the generated brief text and tweet batches', async () => {
    await runBriefingPipeline();
    expect(saveState).toHaveBeenCalledWith(MOCK_BRIEF, expect.any(Object));
  });
});

describe('runBriefingPipeline — empty brief', () => {
  beforeEach(() => setupHappyPath());

  it('does not send a header-only brief to Telegram, but still saves tweets without it as history', async () => {
    generateBrief.mockResolvedValue('🚨 URGENT DEVELOPMENTS:\n\nKEY INTELLIGENCE:');
    await runBriefingPipeline();
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(saveState).toHaveBeenCalledWith('', expect.any(Object));
  });
});

describe('runBriefingPipeline — tweet filtering', () => {
  it('skips run when all tweets are older than lastRunAt', async () => {
    fetchAllTweets.mockResolvedValue(MOCK_RAW);
    stripAllBatches.mockReturnValue(MOCK_STRIPPED);
    // last run AFTER all mock tweet timestamps
    getState.mockReturnValue({ lastRunAt: '2026-04-02T19:00:00.000Z', recentBriefs: [MOCK_PREV_BRIEF], recentTweets: [] });
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
    getState.mockReturnValue({ lastRunAt: null, recentBriefs: [], recentTweets: [] });
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
    expect(saveState).toHaveBeenCalledWith(MOCK_BRIEF, expect.any(Object));
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

describe('capBrief', () => {
  const { capBrief } = require('../../src/briefing');

  it('returns short text unchanged', () => {
    expect(capBrief('hello there', 100)).toBe('hello there');
  });

  it('cuts at a line boundary and drops a dangling header', () => {
    const text = 'First story is complete here.\n\n📈 MARKETS:\n\nSecond story that gets cut mid sentence';
    const out = capBrief(text, 50);
    expect(out).toBe('First story is complete here.');
  });
});
