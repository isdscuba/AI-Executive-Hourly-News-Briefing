'use strict';

const config = require('./config');

/**
 * Formats the current time as "h:mm A ET" (e.g., "9:05 AM ET")
 * Uses Intl.DateTimeFormat — DST-aware, no external dependencies.
 */
function formatEasternTime(date) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }).format(date);
  return `${formatted} ET`;
}

/**
 * Sends the intelligence brief to Telegram.
 * Message format:
 *   🐦 TWITTER INTEL BRIEF | {h:mm A ET}
 *
 *   {brief text, truncated to 4000 chars}
 */
async function sendTelegram(briefText) {
  const time = formatEasternTime(new Date());
  const truncated = briefText.substring(0, 3900);
  const message = `🐦 TWITTER INTEL BRIEF | ${time}\n\n${truncated}`;

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text: message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${body}`);
  }

  const json = await response.json();
  return json;
}

module.exports = { sendTelegram, formatEasternTime };
