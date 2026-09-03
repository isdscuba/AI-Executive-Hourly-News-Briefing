'use strict';

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

jest.mock('../../src/config', () => ({
  twitter: {
    apiKey: 'test-key',
    apiBase: 'https://api.twitterapi.io/twitter/tweet/advanced_search',
    batches: [['acc1'], ['acc2'], ['acc3'], ['acc4'], ['acc5']],
    timeoutMs: 300_000,
  },
  gemini: { apiKey: 'test-gemini-key', model: 'gemini-2.5-flash-lite' },
  telegram: { botToken: 'test-bot-token', chatId: '1304208404' },
  history: { maxEntries: 8 },
  dedup: { shingleSize: 3, jaccardThreshold: 0.85 },
}));

const mockGetState = jest.fn(() => ({ lastRunAt: null, recentBriefs: [], recentTweets: [] }));
const mockSaveState = jest.fn();
jest.mock('../../src/state', () => ({
  getState: mockGetState,
  saveState: mockSaveState,
}));

const rawFixture = require('../fixtures/sample-tweets-raw.json');
const strippedFixture = require('../fixtures/sample-tweets-stripped.json');

function twitterResp(tweets = []) { return JSON.stringify({ tweets }); }
function telegramResp(id = 1) { return JSON.stringify({ ok: true, result: { message_id: id } }); }

describe('Full pipeline integration', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    mockGenerateContent.mockResolvedValue({ response: { text: () => '🚨 URGENT\n🚨 Test item\n\n📈 MARKETS\nUpdate' } });
    mockGetState.mockReturnValue({ lastRunAt: null, recentBriefs: [], recentTweets: [] });
    mockSaveState.mockReset();
  });

  it('runs end-to-end: 5 Twitter fetches + 1 Telegram POST', async () => {
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [telegramResp(99), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await expect(runBriefingPipeline()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls).toHaveLength(6);
  });

  it('passes stripped tweets (not raw) to Gemini prompt', async () => {
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [telegramResp(), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain(strippedFixture[0].author);
    expect(prompt).not.toContain('profilePicture');
    expect(prompt).not.toContain('likeCount');
  });

  it('includes previous brief in prompt when recentBriefs is set (story dedup)', async () => {
    mockGetState.mockReturnValue({ lastRunAt: null, recentBriefs: ['* Previous hour intel here. [T1]'], recentTweets: [] });
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [telegramResp(), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain('Previous hour intel here');
  });

  it('omits story exclusion section on first run', async () => {
    mockGetState.mockReturnValue({ lastRunAt: null, recentBriefs: [], recentTweets: [] });
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [telegramResp(), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
  });

  it('saves state with the generated brief text and tweet batches', async () => {
    // Must cite tweet 1 from rawFixture and share ≥2 of its content words —
    // verifyCitations strips any bullet that doesn't, and would otherwise
    // silently turn this into an empty-string assertion.
    const BRIEF = '* Israeli forces strike Hezbollah command center. [T1]';
    mockGenerateContent.mockResolvedValue({ response: { text: () => BRIEF } });
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [telegramResp(), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    // verifyCitations strips the [Tx] tag from a verified bullet before it's saved.
    expect(mockSaveState).toHaveBeenCalledWith('* Israeli forces strike Hezbollah command center.', expect.any(Object));
  });

  it('filters out old tweets when lastRunAt is set, skipping Gemini if none remain', async () => {
    // Set lastRunAt to far future so fixture tweets are all "old"
    mockGetState.mockReturnValue({ lastRunAt: '2030-01-01T00:00:00.000Z', recentBriefs: ['prev'], recentTweets: [] });
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('skips Gemini but still sends a zero-tweet health alert to Telegram when all batches are empty', async () => {
    fetchMock.mockResponse(twitterResp([]));
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    expect(mockGenerateContent).not.toHaveBeenCalled();
    const telegramCalls = fetchMock.mock.calls.filter(([u]) => u.includes('telegram'));
    expect(telegramCalls).toHaveLength(1);
    const body = JSON.parse(telegramCalls[0][1].body);
    expect(body.text).toContain('returned 0 tweets');
  });

  it('logs token reduction from raw to stripped', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResponses(
      [twitterResp(rawFixture), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [twitterResp([]), { status: 200 }], [twitterResp([]), { status: 200 }],
      [telegramResp(), { status: 200 }],
    );
    const { runBriefingPipeline } = require('../../src/briefing');
    await runBriefingPipeline();
    const logs = spy.mock.calls.map(a => a[0]);
    expect(logs.find(l => l && l.includes('reduction'))).toMatch(/~\d+% reduction/);
    spy.mockRestore();
  });
});
