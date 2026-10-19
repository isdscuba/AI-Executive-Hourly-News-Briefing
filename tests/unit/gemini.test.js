'use strict';

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

jest.mock('../../src/config', () => ({
  gemini: { apiKey: 'test-gemini-key', model: 'gemini-2.5-flash-lite' },
  dedup: { shingleSize: 3, jaccardThreshold: 0.85, storyJaccardThreshold: 0.5 },
}));

const { generateBrief, buildPrompt, buildDeduplicationSection, verifyCitations, extractBullets, dedupeAgainstRecentBriefs } = require('../../src/gemini');

const BATCHES = {
  tweets1: [{ text: 'Tweet A', createdAt: 'Thu Apr 02 18:00:00 +0000 2026', author: 'userA' }],
  tweets2: [{ text: 'Tweet B', createdAt: 'Thu Apr 02 18:05:00 +0000 2026', author: 'userB' }],
  tweets3: [], tweets4: [],
  tweets5: [{ text: 'Tweet C', createdAt: 'Thu Apr 02 18:10:00 +0000 2026', author: 'userC' }],
};

const PREV_BRIEF = '🚨 URGENT DEVELOPMENTS\n🚨 Iran strikes UAE. [T1]\n\nKEY INTELLIGENCE:\n📈 MARKETS\n* S&P down 1% on open. [T2]';

describe('generateBrief — model configuration', () => {
  beforeEach(() => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Generated' } });
  });

  it('uses gemini-2.5-flash-lite', async () => {
    await generateBrief(BATCHES);
    expect(mockGetGenerativeModel.mock.calls[0][0].model).toBe('gemini-2.5-flash-lite');
  });

  it('sets thinkingBudget to 0', async () => {
    await generateBrief(BATCHES);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it('sets responseModalities to ["text"]', async () => {
    await generateBrief(BATCHES);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.responseModalities).toEqual(['text']);
  });

  it('caps maxOutputTokens to guard against repetition-loop runaways', async () => {
    await generateBrief(BATCHES);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.maxOutputTokens).toBe(1536);
  });
});

describe('generateBrief — prompt construction', () => {
  beforeEach(() => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Generated' } });
  });

  it('includes the story exclusion section when recentBriefs has entries', async () => {
    await generateBrief(BATCHES, { recentBriefs: [PREV_BRIEF] });
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain('Iran strikes UAE');
    expect(prompt).toContain('S&P down 1% on open');
  });

  it('omits the story exclusion section on first run (no recentBriefs)', async () => {
    await generateBrief(BATCHES);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
  });

  it('includes current UTC datetime', async () => {
    await generateBrief(BATCHES);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('generateBrief — response handling', () => {
  it('returns extracted text string', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'The brief' } });
    expect(await generateBrief(BATCHES)).toBe('The brief');
  });

  it('throws when Gemini API fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Quota exceeded'));
    await expect(generateBrief(BATCHES)).rejects.toThrow('Quota exceeded');
  });
});

describe('buildDeduplicationSection', () => {
  it('returns empty string for empty array', () => {
    expect(buildDeduplicationSection([])).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(buildDeduplicationSection(null)).toBe('');
    expect(buildDeduplicationSection(undefined)).toBe('');
  });

  it('returns empty string when briefs contain only headers (no bullets)', () => {
    expect(buildDeduplicationSection(['🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n📈 MARKETS'])).toBe('');
  });

  it('flattens a single brief into a per-story bullet list, referencing count as "last 1 brief"', () => {
    const section = buildDeduplicationSection([PREV_BRIEF]);
    expect(section).toContain('STORY EXCLUSION LIST');
    expect(section).toContain('last 1 brief');
    expect(section).not.toContain('last 1 briefs');
    expect(section).toContain('- 🚨 Iran strikes UAE. [T1]');
    expect(section).toContain('- * S&P down 1% on open. [T2]');
  });

  it('strips section headers but keeps story bullets across multiple briefs', () => {
    const briefs = [
      '🚨 URGENT DEVELOPMENTS\n🚨 Story one. [T1]\n\nKEY INTELLIGENCE:\n📈 MARKETS\n* Story two. [T2]',
      '🚨 URGENT DEVELOPMENTS\n🚨 Story three. [T3]',
    ];
    const section = buildDeduplicationSection(briefs);
    expect(section).toContain('last 2 briefs');
    expect(section).toContain('- 🚨 Story one. [T1]');
    expect(section).toContain('- * Story two. [T2]');
    expect(section).toContain('- 🚨 Story three. [T3]');
    expect(section).not.toContain('URGENT DEVELOPMENTS\n');
    expect(section).not.toContain('- 🚨 URGENT DEVELOPMENTS');
    expect(section).not.toContain('- KEY INTELLIGENCE');
  });
});

describe('buildPrompt', () => {
  const base = { allTweets: [], currentUtcDatetime: '2026-03-31T18:00:00.000Z' };

  it('includes story exclusion block when recentBriefs has entries', () => {
    const prompt = buildPrompt({ ...base, recentBriefs: [PREV_BRIEF] });
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain('Iran strikes UAE');
  });

  it('omits story exclusion block when recentBriefs is empty', () => {
    const prompt = buildPrompt({ ...base, recentBriefs: [] });
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
  });

  it('omits story exclusion block when recentBriefs is omitted entirely', () => {
    const prompt = buildPrompt(base);
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
  });

  it('injects current UTC datetime', () => {
    const prompt = buildPrompt({ ...base, recentBriefs: [] });
    expect(prompt).toContain('2026-03-31T18:00:00.000Z');
  });

  it('contains hard character limit constraint', () => {
    const prompt = buildPrompt({ ...base, recentBriefs: [] });
    expect(prompt).toContain('3,800 characters');
  });

  it('numbers tweets in the order given (caller is responsible for sorting)', () => {
    const allTweets = [
      { text: 'Older tweet', createdAt: '2026-03-31T16:00:00.000Z', author: 'a' },
      { text: 'Newer tweet', createdAt: '2026-03-31T17:00:00.000Z', author: 'b' },
    ];
    const prompt = buildPrompt({ ...base, allTweets });
    const olderIdx = prompt.indexOf('[T1]');
    const newerIdx = prompt.indexOf('[T2]');
    expect(prompt.slice(olderIdx, olderIdx + 60)).toContain('Older tweet');
    expect(prompt.slice(newerIdx, newerIdx + 60)).toContain('Newer tweet');
  });
});

describe('generateBrief — recency sort (issue 4)', () => {
  it('sorts tweets most-recent-first before numbering, so [T1] is the newest tweet', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Generated' } });
    const batches = {
      tweets1: [{ text: 'Oldest tweet here', createdAt: '2026-03-31T15:00:00.000Z', author: 'a' }],
      tweets2: [{ text: 'Newest tweet here', createdAt: '2026-03-31T17:00:00.000Z', author: 'b' }],
      tweets3: [{ text: 'Middle tweet here', createdAt: '2026-03-31T16:00:00.000Z', author: 'c' }],
      tweets4: [], tweets5: [],
    };
    await generateBrief(batches);
    const [prompt] = mockGenerateContent.mock.calls[0];
    const t1Idx = prompt.indexOf('[T1]');
    const t2Idx = prompt.indexOf('[T2]');
    const t3Idx = prompt.indexOf('[T3]');
    expect(prompt.slice(t1Idx, t1Idx + 60)).toContain('Newest tweet here');
    expect(prompt.slice(t2Idx, t2Idx + 60)).toContain('Middle tweet here');
    expect(prompt.slice(t3Idx, t3Idx + 60)).toContain('Oldest tweet here');
  });
});

describe('verifyCitations', () => {
  it('verifies un-starred lines under KEY INTELLIGENCE and drops echoed exclusion-list lines', () => {
    const brief = '🚨 URGENT DEVELOPMENTS:\n\nKEY INTELLIGENCE:\n\n🛡️ SECURITY:\n\nThe IDF is on high alert across all sectors today. [STORY EXCLUSION LIST]\n\nSomething happened here today. [T1]';
    const tweets = [{ text: 'Something happened here today confirmed by officials' }];
    const result = verifyCitations(brief, tweets);
    expect(result).not.toContain('IDF');
    expect(result).not.toContain('STORY EXCLUSION LIST');
    expect(result).toContain('Something happened here today.');
  });

  it('normalizes an emoji-prefixed bullet to "*" and still verifies its citation', () => {
    const brief = '🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n📈 MARKETS\n📈 Brent crude prices surged sharply overnight. [T1]';
    const tweets = [{ text: 'Brent crude prices surged sharply overnight amid supply fears' }];
    const result = verifyCitations(brief, tweets);
    expect(result).toContain('* Brent crude prices surged sharply overnight.');
    expect(result).not.toContain('📈 Brent crude');
    expect(result).not.toContain('[T1]');
    expect(result).toContain('📈 MARKETS');
  });

  it('drops a bullet with a malformed citation bracket entirely, even if the referenced tweets exist', () => {
    const tweets = Array.from({ length: 61 }, (_, i) => ({ text: `filler tweet number ${i}` }));
    tweets[23] = { text: 'Oil tankers seized near the strait by naval forces' };
    tweets[59] = { text: 'Oil tankers seized near the strait confirmed by officials' };
    const brief = '🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n📈 MARKETS\n* Oil tankers seized near strait. [T60 - duplicate context with T24 context, but specific locations mentioned]';
    const result = verifyCitations(brief, tweets);
    expect(result).not.toContain('Oil tankers seized near strait');
    expect(result).not.toContain('T60');
    expect(result).not.toContain('T24');
  });

  it('drops a section header immediately followed by another header, keeps one with content', () => {
    const brief = '🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n🚨 BREAKING\n📈 MARKETS\n* Something happened here today. [T1]';
    const tweets = [{ text: 'Something happened here today confirmed by officials' }];
    const result = verifyCitations(brief, tweets);
    expect(result).not.toContain('BREAKING');
    expect(result).toContain('📈 MARKETS');
    expect(result).toContain('Something happened here today.');
  });

  it('drops a header that becomes empty only after its sole bullet fails citation verification', () => {
    const brief = '🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n🛡️ SECURITY\n* Uncited claim about something happening.\n📈 MARKETS\n* Verified market fact happened today. [T1]';
    const tweets = [{ text: 'Verified market fact happened today confirmed by officials' }];
    const result = verifyCitations(brief, tweets);
    expect(result).not.toContain('SECURITY');
    expect(result).not.toContain('Uncited claim');
    expect(result).toContain('📈 MARKETS');
    expect(result).toContain('Verified market fact happened today.');
  });

  it('keeps a header that has surviving content', () => {
    const brief = '🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n📈 MARKETS\n* Verified market fact happened today. [T1]';
    const tweets = [{ text: 'Verified market fact happened today confirmed by officials' }];
    const result = verifyCitations(brief, tweets);
    expect(result).toContain('📈 MARKETS');
    expect(result).toContain('Verified market fact happened today.');
  });
});

describe('extractBullets', () => {
  it('excludes header lines (with or without a trailing colon) but keeps urgent and key bullets', () => {
    const brief = '🚨 URGENT DEVELOPMENTS\n🚨 Story one. [T1]\n\nKEY INTELLIGENCE:\n📈 MARKETS:\n* Story two. [T2]';
    expect(extractBullets(brief)).toEqual(['🚨 Story one. [T1]', '* Story two. [T2]']);
  });
});

describe('dedupeAgainstRecentBriefs (issue 3)', () => {
  it('drops a new bullet that paraphrases a story from a recent brief', () => {
    const recentBriefs = ['🚨 URGENT DEVELOPMENTS\n🚨 Houthi forces seized the strategic port city of Mocha in Yemen. [T1]'];
    const newBrief = '🚨 URGENT DEVELOPMENTS\n🚨 Houthi forces have seized the strategic port city of Mocha in Yemen.\n\nKEY INTELLIGENCE:\n📈 MARKETS\n* Brent crude rose above one hundred seven dollars a barrel.';
    const result = dedupeAgainstRecentBriefs(newBrief, recentBriefs);
    expect(result).not.toContain('Houthi');
    expect(result).toContain('Brent crude rose above one hundred seven dollars a barrel.');
  });

  it('keeps everything when there are no recent briefs', () => {
    const newBrief = '🚨 URGENT DEVELOPMENTS\n🚨 A brand new story just broke.';
    expect(dedupeAgainstRecentBriefs(newBrief, [])).toBe(newBrief);
  });

  it('removes a header left empty by a dropped bullet', () => {
    const recentBriefs = ['🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n🛡️ SECURITY\n* Houthi forces seized the strategic port city of Mocha in Yemen.'];
    const newBrief = '🚨 URGENT DEVELOPMENTS\n\nKEY INTELLIGENCE:\n🛡️ SECURITY\n* Houthi forces have seized the strategic port city of Mocha in Yemen.\n📈 MARKETS\n* Brent crude rose above one hundred seven dollars a barrel.';
    const result = dedupeAgainstRecentBriefs(newBrief, recentBriefs);
    expect(result).not.toContain('SECURITY');
    expect(result).toContain('📈 MARKETS');
  });
});
