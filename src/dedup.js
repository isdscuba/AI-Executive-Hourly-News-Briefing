'use strict';

const config = require('./config');

/**
 * Normalizes tweet text for comparison: lowercase, strip URLs, strip a
 * leading "RT @handle:" prefix, collapse punctuation/whitespace noise.
 */
function normalizeTweetText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/^rt @\w+:\s*/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds a Set of word k-shingles from already-normalized text.
 * Falls back to a single shingle of the whole text when there are
 * fewer than k words, so short tweets don't produce an empty set
 * (which would always compare as dissimilar).
 */
function shingles(normalizedText, k = config.dedup.shingleSize) {
  const words = normalizedText.split(' ').filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length < k) return new Set([words.join(' ')]);

  const result = new Set();
  for (let i = 0; i <= words.length - k; i++) {
    result.add(words.slice(i, i + k).join(' '));
  }
  return result;
}

/**
 * Jaccard similarity between two shingle sets: |intersection| / |union|.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Dedupes a flat list of tweets against an optional pool of already-known
 * representatives, plus against itself (so within-run duplicates across
 * different source batches also collapse).
 *
 * Pass 1 (cheap): drop exact matches on normalized text.
 * Pass 2: drop near-duplicates via word-shingle Jaccard similarity
 * against jaccardThreshold. The first-encountered tweet in a duplicate
 * cluster is always kept as the representative.
 *
 * @param {Array<{text: string}>} tweets - ordered list of new tweets
 * @param {Object} [opts]
 * @param {Array<{text: string}>} [opts.against] - historical representatives to compare against
 * @param {number} [opts.threshold] - Jaccard threshold, defaults to config
 * @returns {{ kept: Array, exactDropped: Array, nearDupDropped: Array }}
 *   nearDupDropped entries are { tweet, matchedText, similarity } for audit logging.
 */
function dedupeTweetPool(tweets, { against = [], threshold = config.dedup.jaccardThreshold } = {}) {
  const seenNormalized = new Set();
  const seenShingles = []; // [{ normalized, shingleSet }]

  for (const rep of against) {
    const normalized = normalizeTweetText(rep.text);
    if (!normalized) continue;
    seenNormalized.add(normalized);
    seenShingles.push({ normalized, shingleSet: shingles(normalized) });
  }

  const kept = [];
  const exactDropped = [];
  const nearDupDropped = [];

  for (const tweet of tweets) {
    const normalized = normalizeTweetText(tweet.text);

    if (!normalized) {
      kept.push(tweet);
      continue;
    }

    if (seenNormalized.has(normalized)) {
      exactDropped.push(tweet);
      continue;
    }

    const tweetShingles = shingles(normalized);
    let matched = null;
    let bestSimilarity = 0;

    for (const seen of seenShingles) {
      const similarity = jaccardSimilarity(tweetShingles, seen.shingleSet);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        matched = seen;
      }
    }

    if (matched && bestSimilarity >= threshold) {
      nearDupDropped.push({ tweet, matchedText: matched.normalized, similarity: bestSimilarity });
      continue;
    }

    kept.push(tweet);
    seenNormalized.add(normalized);
    seenShingles.push({ normalized, shingleSet: tweetShingles });
  }

  return { kept, exactDropped, nearDupDropped };
}

module.exports = { normalizeTweetText, shingles, jaccardSimilarity, dedupeTweetPool };
