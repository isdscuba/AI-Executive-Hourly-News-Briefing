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

const CONTENT_STOPWORDS = new Set([
  'the','and','for','with','from','that','this','these','those','its','their','after','before',
  'about','into','over','under','between','during','against','including','following','within',
  'without','according','because','there','where','when','which','what','who','how','only',
  'said','says','say','told','claim','claims','claimed','report','reports','reported','reportedly',
  'amid','will','would','could','should','have','has','had','been','being','were','was','are',
  'also','more','most','than','then','such','some','other',
]);

function contentWordSet(text) {
  return new Set(
    normalizeTweetText(text).split(' ').filter(w => w.length > 3 && !CONTENT_STOPWORDS.has(w))
  );
}

function numberTokens(text) {
  return new Set((String(text).match(/\d[\d,.]*\d|\d/g) || []).map(n => n.replace(/,/g, '')));
}

/**
 * True when two story bullets read as the same story reworded: the smaller
 * bullet's content words are >= threshold covered by the other. Bullets that
 * both carry numbers but disagree on them are different facts (e.g. successive
 * API stock-change or futures-settlement lines), so they never match.
 */
function sameStoryByContentWords(a, b, threshold) {
  const na = numberTokens(a);
  const nb = numberTokens(b);
  if (na.size > 0 && nb.size > 0 && ![...na].some(n => nb.has(n))) return false;
  const wa = contentWordSet(a);
  const wb = contentWordSet(b);
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size < 4) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size >= threshold;
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
 * Canonicalizes a resolved article URL for exact-match comparison: lowercase
 * host, strip trailing slash, drop query string/fragment entirely. The URL
 * is already t.co-expanded by the API, so this is enough to catch
 * ?utm_source=... variants of the same link without a tracking-param allowlist.
 * Returns null for anything that doesn't parse as a URL.
 */
function canonicalizeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * Dedupes a flat list of tweets against an optional pool of already-known
 * representatives, plus against itself (so within-run duplicates across
 * different source batches also collapse).
 *
 * Pass 1 (cheapest, zero false positives): drop exact tweet-id matches.
 * Pass 2 (cheap, zero false positives): drop exact canonical-URL matches —
 * catches different accounts sharing the same article with different
 * commentary, which text similarity can't see.
 * Pass 3: drop exact matches on normalized text.
 * Pass 4: drop near-duplicates via word-shingle Jaccard similarity
 * against jaccardThreshold. The first-encountered tweet in a duplicate
 * cluster is always kept as the representative. Near-misses (similarity
 * in [0.60, threshold)) are also reported, purely for calibration —
 * they are NOT dropped.
 *
 * Tweets missing an id/url (older history, or text-only tweets) simply
 * skip that pass and fall through to the next one.
 *
 * @param {Array<{text: string, id?: string, url?: string}>} tweets - ordered list of new tweets
 * @param {Object} [opts]
 * @param {Array<{text: string, id?: string, url?: string}>} [opts.against] - historical representatives to compare against
 * @param {number} [opts.threshold] - Jaccard threshold, defaults to config
 * @returns {{ kept: Array, idDropped: Array, urlDropped: Array, exactDropped: Array, nearDupDropped: Array, nearMisses: Array }}
 *   nearDupDropped/nearMisses entries are { tweet, matchedText, similarity } for audit logging.
 */
function dedupeTweetPool(tweets, { against = [], threshold = config.dedup.jaccardThreshold } = {}) {
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenNormalized = new Set();
  const seenShingles = []; // [{ normalized, shingleSet }]

  for (const rep of against) {
    if (rep.id) seenIds.add(rep.id);
    const canonicalUrl = canonicalizeUrl(rep.url);
    if (canonicalUrl) seenUrls.add(canonicalUrl);

    const normalized = normalizeTweetText(rep.text);
    if (!normalized) continue;
    seenNormalized.add(normalized);
    seenShingles.push({ normalized, shingleSet: shingles(normalized) });
  }

  const kept = [];
  const idDropped = [];
  const urlDropped = [];
  const exactDropped = [];
  const nearDupDropped = [];
  const nearMisses = [];

  for (const tweet of tweets) {
    if (tweet.id && seenIds.has(tweet.id)) {
      idDropped.push(tweet);
      continue;
    }

    const canonicalUrl = canonicalizeUrl(tweet.url);
    if (canonicalUrl && seenUrls.has(canonicalUrl)) {
      urlDropped.push(tweet);
      continue;
    }

    const normalized = normalizeTweetText(tweet.text);

    if (!normalized) {
      kept.push(tweet);
      if (tweet.id) seenIds.add(tweet.id);
      if (canonicalUrl) seenUrls.add(canonicalUrl);
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

    if (matched && bestSimilarity >= 0.60) {
      nearMisses.push({ tweet, matchedText: matched.normalized, similarity: bestSimilarity });
    }

    kept.push(tweet);
    if (tweet.id) seenIds.add(tweet.id);
    if (canonicalUrl) seenUrls.add(canonicalUrl);
    seenNormalized.add(normalized);
    seenShingles.push({ normalized, shingleSet: tweetShingles });
  }

  return { kept, idDropped, urlDropped, exactDropped, nearDupDropped, nearMisses };
}

/**
 * Dedupes a flat list of new brief bullets against bullets already sent in
 * recent briefs, using the same word-shingle Jaccard similarity as
 * dedupeTweetPool — but bullets are condensed, paraphrased sentences rather
 * than raw tweet text, so callers should pass a looser threshold (see
 * config.dedup.storyJaccardThreshold) than the raw-tweet jaccardThreshold.
 *
 * Unlike dedupeTweetPool this has no id/URL passes (bullets don't carry
 * either) — it's pure text-similarity, first-match-wins.
 *
 * @param {string[]} newBullets - bullets from the brief just generated
 * @param {string[]} oldBullets - bullets from recent prior briefs
 * @param {number} [threshold] - Jaccard threshold, defaults to config.dedup.storyJaccardThreshold
 * @returns {{ kept: string[], dropped: Array<{ bullet: string, matchedText: string, similarity: number }> }}
 */
function dedupeBulletsAgainstText(newBullets, oldBullets, threshold = config.dedup.storyJaccardThreshold, overlapThreshold = null) {
  const oldShingles = (oldBullets || [])
    .map(raw => ({ raw, normalized: normalizeTweetText(raw) }))
    .filter(o => o.normalized)
    .map(o => ({ ...o, shingleSet: shingles(o.normalized) }));

  const kept = [];
  const dropped = [];

  for (const bullet of newBullets || []) {
    const normalized = normalizeTweetText(bullet);
    if (!normalized) {
      kept.push(bullet);
      continue;
    }

    const bulletShingles = shingles(normalized);
    let matched = null;
    let bestSimilarity = 0;

    for (const seen of oldShingles) {
      let similarity = jaccardSimilarity(bulletShingles, seen.shingleSet);
      // Reworded copies of one story score very low on word-shingles, so also
      // compare content-word overlap when the caller supplies a threshold.
      if (overlapThreshold != null && similarity < threshold
          && sameStoryByContentWords(bullet, seen.raw, overlapThreshold)) {
        similarity = Math.max(similarity, threshold);
      }
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        matched = seen;
      }
    }

    if (matched && bestSimilarity >= threshold) {
      dropped.push({ bullet, matchedText: matched.normalized, similarity: bestSimilarity });
      continue;
    }

    kept.push(bullet);
  }

  return { kept, dropped };
}

module.exports = {
  normalizeTweetText,
  shingles,
  jaccardSimilarity,
  canonicalizeUrl,
  dedupeTweetPool,
  dedupeBulletsAgainstText,
  sameStoryByContentWords,
};
