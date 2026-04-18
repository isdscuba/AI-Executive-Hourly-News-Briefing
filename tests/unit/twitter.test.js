'use strict';

const { fetchAllTweets, formatSinceTimestamp, buildQuery } = require('../../src/twitter');

// Mock config to control batch accounts and keys
jest.mock('../../src/config', () => ({
  twitter: {
    apiKey: 'test-api-key',
    apiBase: 'https://api.twitterapi.io/twitter/tweet/advanced_search',
    batches: [
      ['acc1a', 'acc1b'],
      ['acc2a', 'acc2b'],
      ['acc3a'],
      ['acc4a', 'acc4b', 'acc4c'],
      ['acc5a'],
    ],
    timeoutMs: 300_000,
  },
}));

describe('formatSinceTimestamp', () => {
  it('formats a Date as YYYY-MM-DD_HH:mm:ss_UTC', () => {
    const date = new Date('2026-03-31T18:00:00.000Z');
    expect(formatSinceTimestamp(date)).toBe('2026-03-31_18:00:00_UTC');
  });

  it('pads single-digit months and days', () => {
    const date = new Date('2026-01-05T09:07:03.000Z');
    expect(formatSinceTimestamp(date)).toBe('2026-01-05_09:07:03_UTC');
  });

  it('handles hour rollover correctly (01:00 UTC → 00:00 UTC same day)', () => {
    const since = new Date('2026-03-31T01:00:00.000Z');
    // 1 hour before 01:00 UTC = 00:00 UTC same day
    const oneHourBefore = new Date(since.getTime() - 3_600_000);
    expect(formatSinceTimestamp(oneHourBefore)).toBe('2026-03-31_00:00:00_UTC');
  });

  it('handles day rollover correctly (00:30 UTC → 23:30 UTC previous day)', () => {
    const since = new Date('2026-03-31T00:30:00.000Z');
    const oneHourBefore = new Date(since.getTime() - 3_600_000);
    expect(formatSinceTimestamp(oneHourBefore)).toBe('2026-03-30_23:30:00_UTC');
  });

  it('uses UTC methods (not local time methods)', () => {
    // Create a date that is 23:00 UTC but would be a different hour in ET
    const date = new Date('2026-03-31T23:00:00.000Z');
    const result = formatSinceTimestamp(date);
    expect(result).toBe('2026-03-31_23:00:00_UTC');
    // If local time were used (ET = UTC-4 in EDT), hour would be 19, not 23
    expect(result).not.toMatch(/_19:/);
  });
});

describe('buildQuery', () => {
  it('builds a query with OR-joined from: clauses', () => {
    const q = buildQuery(['acc1', 'acc2', 'acc3'], '2026-03-31_18:00:00_UTC');
    expect(q).toBe('(from:acc1 OR from:acc2 OR from:acc3) lang:en since:2026-03-31_18:00:00_UTC');
  });

  it('includes lang:en', () => {
    const q = buildQuery(['acc1'], '2026-01-01_00:00:00_UTC');
    expect(q).toContain('lang:en');
  });

  it('includes the since timestamp', () => {
    const since = '2026-03-31_12:00:00_UTC';
    const q = buildQuery(['acc1'], since);
    expect(q).toContain(`since:${since}`);
  });

  it('wraps the from clause in parentheses', () => {
    const q = buildQuery(['acc1', 'acc2'], '2026-01-01_00:00:00_UTC');
    expect(q).toMatch(/^\(from:/);
  });
});

describe('fetchAllTweets', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('returns the tweets1..tweets5 shape', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    const result = await fetchAllTweets();
    expect(result).toHaveProperty('tweets1');
    expect(result).toHaveProperty('tweets2');
    expect(result).toHaveProperty('tweets3');
    expect(result).toHaveProperty('tweets4');
    expect(result).toHaveProperty('tweets5');
  });

  it('sends x-api-key header', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    await fetchAllTweets();
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBe(5);
    calls.forEach(([, options]) => {
      expect(options.headers['x-api-key']).toBe('test-api-key');
    });
  });

  it('sends Accept-Encoding: gzip header', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    await fetchAllTweets();
    fetchMock.mock.calls.forEach(([, options]) => {
      expect(options.headers['Accept-Encoding']).toBe('gzip');
    });
  });

  it('calls the correct twitterapi.io endpoint', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    await fetchAllTweets();
    fetchMock.mock.calls.forEach(([url]) => {
      expect(url).toContain('api.twitterapi.io/twitter/tweet/advanced_search');
    });
  });

  it('fires all 5 requests (parallelism check)', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    await fetchAllTweets();
    expect(fetchMock.mock.calls.length).toBe(5);
  });

  it('returns tweets array from a successful response', async () => {
    const mockTweets = [{ id: '1', text: 'hello', createdAt: '2026-01-01T00:00:00Z', author: { userName: 'user1' } }];
    fetchMock.mockResponse(JSON.stringify({ tweets: mockTweets }));
    const result = await fetchAllTweets();
    expect(result.tweets1).toEqual(mockTweets);
  });

  it('returns [] for a batch when the API returns non-2xx', async () => {
    // First batch fails with 429, rest succeed
    fetchMock.mockResponses(
      [JSON.stringify({ error: 'rate limited' }), { status: 429 }],
      [JSON.stringify({ tweets: [{ id: '2' }] }), { status: 200 }],
      [JSON.stringify({ tweets: [] }), { status: 200 }],
      [JSON.stringify({ tweets: [] }), { status: 200 }],
      [JSON.stringify({ tweets: [] }), { status: 200 }],
    );
    const result = await fetchAllTweets();
    expect(result.tweets1).toEqual([]);
    expect(result.tweets2).toEqual([{ id: '2' }]);
  });

  it('returns [] for a batch when the response has no tweets field', async () => {
    fetchMock.mockResponse(JSON.stringify({ status: 'ok' })); // no tweets field
    const result = await fetchAllTweets();
    expect(result.tweets1).toEqual([]);
  });

  it('returns [] for a batch when a network error occurs', async () => {
    fetchMock.mockRejectOnce(new Error('Network failure'));
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    const result = await fetchAllTweets();
    expect(result.tweets1).toEqual([]);
  });

  it('returns all [] when all 5 batches fail', async () => {
    fetchMock.mockReject(new Error('All networks down'));
    const result = await fetchAllTweets();
    expect(result.tweets1).toEqual([]);
    expect(result.tweets2).toEqual([]);
    expect(result.tweets3).toEqual([]);
    expect(result.tweets4).toEqual([]);
    expect(result.tweets5).toEqual([]);
  });

  it('includes queryType=Latest in the request URL', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    await fetchAllTweets();
    fetchMock.mock.calls.forEach(([url]) => {
      expect(url).toContain('queryType=Latest');
    });
  });

  it('includes lang:en in the query param', async () => {
    fetchMock.mockResponse(JSON.stringify({ tweets: [] }));
    await fetchAllTweets();
    fetchMock.mock.calls.forEach(([url]) => {
      expect(decodeURIComponent(url)).toContain('lang:en');
    });
  });
});
