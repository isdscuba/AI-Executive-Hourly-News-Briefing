'use strict';

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

jest.mock('../../src/config', () => ({
  gemini: { apiKey: 'test-gemini-key', model: 'gemini-2.5-flash-lite' },
}));

const { generateBrief, buildPrompt, buildDeduplicationSection } = require('../../src/gemini');

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
});
