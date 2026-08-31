'use strict';

const { normalizeTweetText, shingles, jaccardSimilarity, canonicalizeUrl, dedupeTweetPool } = require('../../src/dedup');

describe('normalizeTweetText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTweetText('  Hello   WORLD  ')).toBe('hello world');
  });

  it('strips URLs', () => {
    expect(normalizeTweetText('Big news https://t.co/abc123 today')).toBe('big news today');
  });

  it('strips a leading RT @handle: prefix', () => {
    expect(normalizeTweetText('RT @someuser: Big news today')).toBe('big news today');
  });

  it('strips punctuation', () => {
    expect(normalizeTweetText("It's happening, now!")).toBe('it s happening now');
  });

  it('handles empty/undefined input', () => {
    expect(normalizeTweetText('')).toBe('');
    expect(normalizeTweetText(undefined)).toBe('');
  });
});

describe('shingles', () => {
  it('builds word k-shingles', () => {
    const result = shingles('the quick brown fox', 3);
    expect(result).toEqual(new Set(['the quick brown', 'quick brown fox']));
  });

  it('falls back to a single shingle when fewer than k words', () => {
    const result = shingles('hello world', 3);
    expect(result).toEqual(new Set(['hello world']));
  });

  it('returns an empty set for empty text', () => {
    expect(shingles('', 3)).toEqual(new Set());
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const a = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(a, new Set(['a', 'b', 'c']))).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4);
  });
});

describe('canonicalizeUrl', () => {
  it('lowercases the host and drops query string and fragment', () => {
    expect(canonicalizeUrl('https://Example.com/Article?utm_source=twitter#top')).toBe('example.com/Article');
  });

  it('strips a trailing slash', () => {
    expect(canonicalizeUrl('https://example.com/article/')).toBe('example.com/article');
  });

  it('returns null for null/undefined/unparseable input', () => {
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl(undefined)).toBeNull();
    expect(canonicalizeUrl('not a url')).toBeNull();
  });
});

describe('dedupeTweetPool', () => {
  it('keeps everything when there is nothing to compare against', () => {
    const tweets = [{ text: 'first story' }, { text: 'second story' }];
    const { kept } = dedupeTweetPool(tweets);
    expect(kept).toHaveLength(2);
  });

  it('drops an exact duplicate against the historical pool', () => {
    const { kept, exactDropped } = dedupeTweetPool(
      [{ text: 'breaking news today' }],
      { against: [{ text: 'breaking news today' }] }
    );
    expect(kept).toHaveLength(0);
    expect(exactDropped).toHaveLength(1);
  });

  it('drops a near-duplicate above the threshold', () => {
    const original = 'large explosion reported near central train station in downtown area sources say blast was reported';
    const paraphrase = 'large explosion reported near central train station in downtown area sources say blast was confirmed';
    const { kept, nearDupDropped } = dedupeTweetPool(
      [{ text: paraphrase }],
      { against: [{ text: original }] }
    );
    expect(kept).toHaveLength(0);
    expect(nearDupDropped).toHaveLength(1);
    expect(nearDupDropped[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps a distinct story below the threshold', () => {
    const { kept } = dedupeTweetPool(
      [{ text: 'death toll from the border region explosion rises to 12 officials say' }],
      { against: [{ text: 'officials confirm explosion near the capital city border region' }] }
    );
    expect(kept).toHaveLength(1);
  });

  it('respects a custom threshold', () => {
    const a = 'the quick brown fox jumps over the lazy dog';
    const b = 'the quick brown fox jumps over the lazy cat';
    const strict = dedupeTweetPool([{ text: b }], { against: [{ text: a }], threshold: 0.99 });
    expect(strict.kept).toHaveLength(1);

    const lenient = dedupeTweetPool([{ text: b }], { against: [{ text: a }], threshold: 0.5 });
    expect(lenient.kept).toHaveLength(0);
  });

  it('collapses duplicates within the same input list, not just against history', () => {
    const original = 'large explosion reported near central train station in downtown area sources say blast was reported';
    const paraphrase = 'large explosion reported near central train station in downtown area sources say blast was confirmed';
    const { kept } = dedupeTweetPool([{ text: original }, { text: paraphrase }]);
    expect(kept).toHaveLength(1);
  });

  it('drops an exact tweet-id match against the historical pool, before any text comparison', () => {
    const { kept, idDropped } = dedupeTweetPool(
      [{ text: 'completely different wording now', id: '42' }],
      { against: [{ text: 'original wording', id: '42' }] }
    );
    expect(kept).toHaveLength(0);
    expect(idDropped).toHaveLength(1);
  });

  it('drops a canonical-URL match even when the surrounding text is completely different', () => {
    const { kept, urlDropped } = dedupeTweetPool(
      [{ text: 'Wow, huge story, everyone is talking about this', url: 'https://example.com/article?utm_source=x' }],
      { against: [{ text: 'Breaking: something happened', url: 'https://example.com/article' }] }
    );
    expect(kept).toHaveLength(0);
    expect(urlDropped).toHaveLength(1);
  });

  it('falls through cleanly to text-based dedup when id/url are absent', () => {
    const { kept, exactDropped } = dedupeTweetPool(
      [{ text: 'breaking news today', id: null, url: null }],
      { against: [{ text: 'breaking news today', id: null, url: null }] }
    );
    expect(kept).toHaveLength(0);
    expect(exactDropped).toHaveLength(1);
  });

  it('does not drop on url match when the tweet has no url', () => {
    const { kept, urlDropped } = dedupeTweetPool(
      [{ text: 'a distinct headline about something else' }],
      { against: [{ text: 'a totally unrelated older headline', url: 'https://example.com/article' }] }
    );
    expect(urlDropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it('reports a near-miss below the drop threshold without dropping the tweet', () => {
    const original = 'large explosion reported near central train station in downtown area sources say blast was reported';
    // Jaccard similarity ~0.80 against `original` — below the 0.85 drop threshold, above the 0.60 report floor.
    const distinctButSimilar = 'large explosion reported near central train station in downtown area sources say blast was confirmed dead';
    const { kept, nearMisses } = dedupeTweetPool(
      [{ text: distinctButSimilar }],
      { against: [{ text: original }] }
    );
    expect(kept).toHaveLength(1);
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0].similarity).toBeLessThan(0.85);
    expect(nearMisses[0].similarity).toBeGreaterThanOrEqual(0.60);
  });
});
