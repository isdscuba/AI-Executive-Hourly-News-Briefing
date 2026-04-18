'use strict';

const config = require('./config');

/**
 * Formats a Date object as YYYY-MM-DD_HH:mm:ss_UTC
 * Uses getUTC* methods — critical, Mac Mini runs in ET not UTC.
 */
function formatSinceTimestamp(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}:${min}:${ss}_UTC`;
}

/**
 * Builds the query string for a batch of account handles.
 */
function buildQuery(accounts, sinceTimestamp) {
  const fromClause = accounts.map(a => `from:${a}`).join(' OR ');
  return `(${fromClause}) lang:en since:${sinceTimestamp}`;
}

/**
 * Fetches tweets for a single batch. Returns data.tweets array or [] on any error.
 */
async function fetchBatch(accounts, sinceTimestamp) {
  const query = buildQuery(accounts, sinceTimestamp);
  const url = new URL(config.twitter.apiBase);
  url.searchParams.set('queryType', 'Latest');
  url.searchParams.set('query', query);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.twitter.timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'x-api-key': config.twitter.apiKey,
        'Accept-Encoding': 'gzip',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[twitter] Batch fetch failed: HTTP ${response.status}`);
      return [];
    }

    const json = await response.json();
    // API returns { tweets: [...] } at top level (not nested under data)
    return Array.isArray(json?.tweets) ? json.tweets : [];
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error('[twitter] Batch timed out after 300s');
    } else {
      console.error('[twitter] Batch fetch error:', err.message);
    }
    return [];
  }
}

/**
 * Fetches all 5 Twitter batches in parallel.
 * Returns { tweets1, tweets2, tweets3, tweets4, tweets5 } where each
 * value is the raw tweets array (or [] on failure).
 *
 * @param {string|null} sinceIso - Optional ISO timestamp override for the since filter.
 *   Defaults to 1 hour ago. Pass midnight ET ISO string for opening briefs.
 */
async function fetchAllTweets(sinceIso = null) {
  const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 3_600_000);
  const sinceTimestamp = formatSinceTimestamp(since);

  const [tweets1, tweets2, tweets3, tweets4, tweets5] = await Promise.all(
    config.twitter.batches.map(accounts => fetchBatch(accounts, sinceTimestamp))
  );

  return { tweets1, tweets2, tweets3, tweets4, tweets5 };
}

module.exports = { fetchAllTweets, formatSinceTimestamp, buildQuery };
