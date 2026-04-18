'use strict';

/**
 * Strips a raw Twitter API tweet array down to only the fields
 * Gemini needs for intelligence analysis.
 *
 * Input:  Raw data.tweets array from twitterapi.io (~3-5KB per tweet)
 * Output: Minimal array of { text, createdAt, author } objects
 *
 * Expected reduction: ~95% token savings (178K → ~8K tokens)
 */
function stripTweets(rawTweets) {
  if (!Array.isArray(rawTweets)) return [];

  return rawTweets.map(tweet => ({
    text: tweet?.text,
    createdAt: tweet?.createdAt,
    author: tweet?.author?.userName ?? 'unknown',
  }));
}

/**
 * Applies stripTweets to all 5 batches.
 * Input/output shape: { tweets1, tweets2, tweets3, tweets4, tweets5 }
 */
function stripAllBatches({ tweets1, tweets2, tweets3, tweets4, tweets5 }) {
  return {
    tweets1: stripTweets(tweets1),
    tweets2: stripTweets(tweets2),
    tweets3: stripTweets(tweets3),
    tweets4: stripTweets(tweets4),
    tweets5: stripTweets(tweets5),
  };
}

module.exports = { stripTweets, stripAllBatches };
