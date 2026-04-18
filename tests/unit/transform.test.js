'use strict';

const { stripTweets, stripAllBatches } = require('../../src/transform');
const rawFixture = require('../fixtures/sample-tweets-raw.json');
const strippedFixture = require('../fixtures/sample-tweets-stripped.json');

describe('stripTweets', () => {
  it('extracts text, createdAt, and author.userName from a valid tweet', () => {
    const result = stripTweets(rawFixture);
    expect(result).toEqual(strippedFixture);
  });

  it('returns only 3 fields per tweet (no extra fields)', () => {
    const result = stripTweets(rawFixture);
    result.forEach(tweet => {
      expect(Object.keys(tweet)).toEqual(['text', 'createdAt', 'author']);
    });
  });

  it('returns an empty array when given null', () => {
    expect(stripTweets(null)).toEqual([]);
  });

  it('returns an empty array when given undefined', () => {
    expect(stripTweets(undefined)).toEqual([]);
  });

  it('returns an empty array when given a string', () => {
    expect(stripTweets('not an array')).toEqual([]);
  });

  it('returns an empty array when given a plain object', () => {
    expect(stripTweets({ tweets: [] })).toEqual([]);
  });

  it('returns an empty array when given an empty array', () => {
    expect(stripTweets([])).toEqual([]);
  });

  it('falls back to "unknown" when author is missing entirely', () => {
    const tweet = { text: 'test', createdAt: '2026-01-01T00:00:00Z' };
    const result = stripTweets([tweet]);
    expect(result[0].author).toBe('unknown');
  });

  it('falls back to "unknown" when author.userName is undefined', () => {
    const tweet = { text: 'test', createdAt: '2026-01-01T00:00:00Z', author: { name: 'Full Name' } };
    const result = stripTweets([tweet]);
    expect(result[0].author).toBe('unknown');
  });

  it('uses author.userName when present', () => {
    const tweet = { text: 'test', createdAt: '2026-01-01T00:00:00Z', author: { userName: 'testUser', name: 'Test User' } };
    const result = stripTweets([tweet]);
    expect(result[0].author).toBe('testUser');
  });

  it('strips all extra fields (engagement counts, media, card, etc.)', () => {
    const result = stripTweets(rawFixture);
    result.forEach(tweet => {
      expect(tweet).not.toHaveProperty('id');
      expect(tweet).not.toHaveProperty('likeCount');
      expect(tweet).not.toHaveProperty('retweetCount');
      expect(tweet).not.toHaveProperty('viewCount');
      expect(tweet).not.toHaveProperty('bookmarkCount');
      expect(tweet).not.toHaveProperty('entities');
      expect(tweet).not.toHaveProperty('extendedEntities');
      expect(tweet).not.toHaveProperty('card');
      expect(tweet).not.toHaveProperty('quoted_tweet');
      expect(tweet).not.toHaveProperty('source');
      expect(tweet).not.toHaveProperty('conversationId');
    });
  });

  it('handles an array with mixed valid and invalid tweet shapes', () => {
    const mixed = [
      { text: 'valid', createdAt: '2026-01-01T00:00:00Z', author: { userName: 'user1' } },
      { createdAt: '2026-01-01T00:00:00Z', author: { userName: 'user2' } }, // missing text
      null, // null entry — will produce { text: undefined, createdAt: undefined, author: 'unknown' }
    ];
    const result = stripTweets(mixed);
    expect(result).toHaveLength(3);
    expect(result[0].author).toBe('user1');
    expect(result[1].author).toBe('user2');
    expect(result[2].author).toBe('unknown');
  });
});

describe('stripAllBatches', () => {
  it('applies stripTweets to all 5 batches and returns correct shape', () => {
    const input = {
      tweets1: rawFixture.slice(0, 1),
      tweets2: rawFixture.slice(1, 2),
      tweets3: rawFixture.slice(2, 3),
      tweets4: rawFixture.slice(0, 2),
      tweets5: [],
    };
    const result = stripAllBatches(input);
    expect(result).toHaveProperty('tweets1');
    expect(result).toHaveProperty('tweets2');
    expect(result).toHaveProperty('tweets3');
    expect(result).toHaveProperty('tweets4');
    expect(result).toHaveProperty('tweets5');
    expect(result.tweets1).toHaveLength(1);
    expect(result.tweets2).toHaveLength(1);
    expect(result.tweets3).toHaveLength(1);
    expect(result.tweets4).toHaveLength(2);
    expect(result.tweets5).toHaveLength(0);
  });

  it('returns empty arrays for null batches', () => {
    const result = stripAllBatches({
      tweets1: null,
      tweets2: undefined,
      tweets3: [],
      tweets4: null,
      tweets5: undefined,
    });
    expect(result.tweets1).toEqual([]);
    expect(result.tweets2).toEqual([]);
    expect(result.tweets3).toEqual([]);
    expect(result.tweets4).toEqual([]);
    expect(result.tweets5).toEqual([]);
  });

  it('each stripped tweet in output has only text, createdAt, author fields', () => {
    const result = stripAllBatches({
      tweets1: rawFixture,
      tweets2: [],
      tweets3: [],
      tweets4: [],
      tweets5: [],
    });
    result.tweets1.forEach(t => {
      expect(Object.keys(t)).toEqual(['text', 'createdAt', 'author']);
    });
  });
});
