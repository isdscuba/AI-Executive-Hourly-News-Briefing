'use strict';

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

jest.mock('../../src/config', () => ({
  gemini: { apiKey: 'test-gemini-key', model: 'gemini-2.5-flash-lite' },
}));

const { generateBrief, buildPrompt } = require('../../src/gemini');

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
    await generateBrief(BATCHES, null);
    expect(mockGetGenerativeModel.mock.calls[0][0].model).toBe('gemini-2.5-flash-lite');
  });

  it('sets thinkingBudget to 0', async () => {
    await generateBrief(BATCHES, null);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });

  it('sets responseModalities to ["text"]', async () => {
    await generateBrief(BATCHES, null);
    expect(mockGetGenerativeModel.mock.calls[0][0].generationConfig.responseModalities).toEqual(['text']);
  });
});

describe('generateBrief — prompt construction', () => {
  beforeEach(() => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'Generated' } });
  });

  it('includes tweets5 before tweets1 in the prompt', async () => {
    await generateBrief(BATCHES, null);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt.indexOf(JSON.stringify(BATCHES.tweets5))).toBeLessThan(
      prompt.indexOf(JSON.stringify(BATCHES.tweets1))
    );
  });

  it('includes the story exclusion section when lastBriefText is provided', async () => {
    await generateBrief(BATCHES, PREV_BRIEF);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain(PREV_BRIEF);
    expect(prompt).toContain('PREVIOUS_BRIEF_DO_NOT_OUTPUT');
  });

  it('omits the story exclusion section on first run (null lastBriefText)', async () => {
    await generateBrief(BATCHES, null);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
    expect(prompt).not.toContain('PREVIOUS_BRIEF_DO_NOT_OUTPUT');
  });

  it('includes current UTC datetime', async () => {
    await generateBrief(BATCHES, null);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('mentions pre-filtering of exact duplicates', async () => {
    await generateBrief(BATCHES, null);
    const [prompt] = mockGenerateContent.mock.calls[0];
    expect(prompt).toContain('pre-filtered');
  });
});

describe('generateBrief — response handling', () => {
  it('returns extracted text string', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'The brief' } });
    expect(await generateBrief(BATCHES, null)).toBe('The brief');
  });

  it('throws when Gemini API fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Quota exceeded'));
    await expect(generateBrief(BATCHES, null)).rejects.toThrow('Quota exceeded');
  });
});

describe('buildPrompt', () => {
  const base = { tweets1Json: '[]', tweets2Json: '[]', tweets3Json: '[]', tweets4Json: '[]', tweets5Json: '[]', currentUtcDatetime: '2026-03-31T18:00:00.000Z' };

  it('includes story exclusion block when lastBriefText is provided', () => {
    const prompt = buildPrompt({ ...base, lastBriefText: 'prev brief' });
    expect(prompt).toContain('STORY EXCLUSION LIST');
    expect(prompt).toContain('prev brief');
  });

  it('omits story exclusion block when lastBriefText is null', () => {
    const prompt = buildPrompt({ ...base, lastBriefText: null });
    expect(prompt).not.toContain('STORY EXCLUSION LIST');
  });

  it('contains the 3 golden rules section', () => {
    const prompt = buildPrompt({ ...base, lastBriefText: null });
    expect(prompt).toContain('3 GOLDEN RULES');
    expect(prompt).toContain('3,500 characters');
  });

  it('injects current UTC datetime', () => {
    const prompt = buildPrompt({ ...base, lastBriefText: null });
    expect(prompt).toContain('2026-03-31T18:00:00.000Z');
  });
});
