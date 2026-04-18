'use strict';

jest.mock('../../src/config', () => ({
  telegram: {
    botToken: 'test-bot-token',
    chatId: '1304208404',
  },
}));

const { sendTelegram, formatEasternTime } = require('../../src/telegram');

describe('formatEasternTime', () => {
  it('returns a string ending in " ET"', () => {
    const result = formatEasternTime(new Date());
    expect(result).toMatch(/ ET$/);
  });

  it('formats a known UTC time correctly in EST (UTC-5, winter)', () => {
    // Jan 15 14:00 UTC = 09:00 AM EST
    const date = new Date('2026-01-15T14:00:00.000Z');
    const result = formatEasternTime(date);
    expect(result).toBe('9:00 AM ET');
  });

  it('formats a known UTC time correctly in EDT (UTC-4, summer)', () => {
    // Jul 15 18:00 UTC = 2:00 PM EDT
    const date = new Date('2026-07-15T18:00:00.000Z');
    const result = formatEasternTime(date);
    expect(result).toBe('2:00 PM ET');
  });

  it('pads minutes with leading zero', () => {
    // Jan 15 14:05 UTC = 9:05 AM EST
    const date = new Date('2026-01-15T14:05:00.000Z');
    const result = formatEasternTime(date);
    expect(result).toBe('9:05 AM ET');
  });

  it('handles noon correctly (12:00 PM)', () => {
    // Jan 15 17:00 UTC = 12:00 PM EST
    const date = new Date('2026-01-15T17:00:00.000Z');
    const result = formatEasternTime(date);
    expect(result).toBe('12:00 PM ET');
  });

  it('handles midnight correctly (12:00 AM)', () => {
    // Jan 15 05:00 UTC = 12:00 AM EST
    const date = new Date('2026-01-15T05:00:00.000Z');
    const result = formatEasternTime(date);
    expect(result).toBe('12:00 AM ET');
  });
});

describe('sendTelegram', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('POSTs to the correct Telegram endpoint', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 123 } }));
    await sendTelegram('Test brief');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
  });

  it('sends Content-Type: application/json', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    await sendTelegram('Test brief');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('sends the correct chat_id', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    await sendTelegram('Test brief');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('1304208404');
  });

  it('does not set parse_mode', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    await sendTelegram('Test brief');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.parse_mode).toBeUndefined();
  });

  it('prefixes the message with the header and time', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    await sendTelegram('My brief content');
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.text).toMatch(/^🐦 TWITTER INTEL BRIEF \| .+ ET\n\n/);
    expect(body.text).toContain('My brief content');
  });

  it('truncates brief text to 4000 characters', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    const longText = 'x'.repeat(5000);
    await sendTelegram(longText);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    // The body includes the header (~30 chars) + 4000 chars of brief
    const headerLength = body.text.indexOf('\n\n') + 2;
    const briefPortion = body.text.slice(headerLength);
    expect(briefPortion).toHaveLength(4000);
    expect(briefPortion).toBe('x'.repeat(4000));
  });

  it('does not truncate when brief text is under 4000 characters', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    const shortText = 'Short brief';
    await sendTelegram(shortText);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.text).toContain('Short brief');
    const headerLength = body.text.indexOf('\n\n') + 2;
    expect(body.text.slice(headerLength)).toBe('Short brief');
  });

  it('returns the API response JSON on success', async () => {
    const mockResponse = { ok: true, result: { message_id: 999 } };
    fetchMock.mockResponseOnce(JSON.stringify(mockResponse));
    const result = await sendTelegram('brief');
    expect(result).toEqual(mockResponse);
  });

  it('throws when the API returns a non-2xx response', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: false, error_code: 400 }), { status: 400 });
    await expect(sendTelegram('brief')).rejects.toThrow('Telegram API error 400');
  });

  it('uses POST method', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    await sendTelegram('brief');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
  });
});
