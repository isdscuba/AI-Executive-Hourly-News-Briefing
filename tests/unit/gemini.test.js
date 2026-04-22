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

const PREV_BRIEF = '🚨 Iran strikes UAE. 📈 S&P down 1%.';

describe('generateBrief — model configuration', () => {
  beforeEach(() => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Generated' } });
  });

  it('uses gemini-2.5-flash-lite', async () => {
    await generateBrief(BATCHES, []);
    expect(mockGetGenerativeModel.mock.calls[0][0].model).toBe('gemini-2.5-flash-lite');
  });

  it('sets thinkingBudget to 0', async () => {
    await generateBrief(BATCHES, []);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it('sets responseModalities to ["text"]', async () => {
    await generateBrief(BATCHES, []);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.responseModalities).toEqual(['text']);
  });
});

describe('generateBrief — prompt construction', () => {
  beforeEach(() => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Generated' } });
  });

  it('includes the story exclusion section when recentBriefs has entries', async () => {
    await generateBrief(BATCHES, [PREV_BRIEF]);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain(PREV_BRIEF);
    expect(prompt).toContain('PREVIOUS_BRIEF_1_DO_NOT_OUTPUT');
  });

  it('includes all briefs when recentBriefs has multiple entries', async () => {
    await generateBrief(BATCHES, ['Brief 1', 'Brief 2', 'Brief 3']);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('PREVIOUS_BRIEF_1_DO_NOT_OUTPUT');
    expect(prompt).toContain('PREVIOUS_BRIEF_2_DO_NOT_OUTPUT');
    expect(prompt).toContain('PREVIOUS_BRIEF_3_DO_NOT_OUTPUT');
    expect(prompt).toContain('last 3 briefs');
  });

  it('omits the story exclusion section on first run (empty recentBriefs)', async () => {
    await generateBrief(BATCHES, []);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
    expect(prompt).not.toContain('PREVIOUS_BRIEF_1_DO_NOT_OUTPUT');
  });

  it('includes current UTC datetime', async () => {
    await generateBrief(BATCHES, []);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('mentions pre-filtering of exact duplicates', async () => {
    await generateBrief(BATCHES, []);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('pre-filtered');
  });
});

describe('generateBrief — response handling', () => {
  it('returns extracted text string', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'The brief' } });
    expect(await generateBrief(BATCHES, [])).toBe('The brief');
  });

  it('throws when Gemini API fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Quota exceeded'));
    await expect(generateBrief(BATCHES, [])).rejects.toThrow('Quota exceeded');
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

  it('includes STORY EXCLUSION LIST for single brief', () => {
    const section = buildDeduplicationSection(['Brief A']);
    expect(section).toContain('STORY EXCLUSION LIST');
    expect(section).toContain('last 1 brief');
    expect(section).toContain('PREVIOUS_BRIEF_1_DO_NOT_OUTPUT');
    expect(section).toContain('Brief A');
  });

  it('includes all briefs for multiple entries', () => {
    const section = buildDeduplicationSection(['Brief A', 'Brief B', 'Brief C']);
    expect(section).toContain('last 3 briefs');
    expect(section).toContain('PREVIOUS_BRIEF_1_DO_NOT_OUTPUT');
    expect(section).toContain('PREVIOUS_BRIEF_2_DO_NOT_OUTPUT');
    expect(section).toContain('PREVIOUS_BRIEF_3_DO_NOT_OUTPUT');
    expect(section).toContain('Brief A');
    expect(section).toContain('Brief C');
  });
});

describe('buildPrompt', () => {
  const base = { tweets1Json: '[]', tweets2Json: '[]', tweets3Json: '[]', tweets4Json: '[]', tweets5Json: '[]', currentUtcDatetime: '2026-03-31T18:00:00.000Z' };

  it('includes story exclusion block when recentBriefs has entries', () => {
    const prompt = buildPrompt({ ...base, recentBriefs: ['prev brief'] });
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain('prev brief');
  });

  it('omits story exclusion block when recentBriefs is empty', () => {
    const prompt = buildPrompt({ ...base, recentBriefs: [] });
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
