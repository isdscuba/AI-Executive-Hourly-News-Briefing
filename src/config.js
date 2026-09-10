'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  twitter: {
    apiKey: process.env.TWITTER_API_KEY,
    apiBase: process.env.TWITTER_API_BASE || 'https://api.twitterapi.io/twitter/tweet/advanced_search',
    // 5 account batches executed in parallel
    batches: [
      ['nexta_tv', 'zerohedge', 'lookner', 'ariehkovler', 'RonFilipkowski', 'maggieNYT', 'TreyYingst'],
      ['Osint613', 'sentdefender', 'IntelCrab', 'bellingcat', 'ELINTNews', 'AuroraIntel', 'IntelPointAlert', 'JakeTapper'],
      ['IntelDoge', 'IntelSky', 'AircraftSpots', 'air_intel', 'Global_MIL_Info', 'Osinttechnical', 'WarSpotting', 'MT_Anderson'],
      ['EretzIsrael', 'gaza_report', 'Israel_Alma_org', 'IsraelRadar_com', 'rawsalerts', 'DanWilliams', 'Tendar', 'FinancialJuice', 'AvivaKlompas', 'BBCBreaking'],
      ['CNNBrk', 'Reuters', 'AP', 'WSJbreakingnews', 'AJEnglish'],
    ],
    timeoutMs: 300_000, // 300 seconds per request
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  schedule: {
    timezone: process.env.TIMEZONE || 'America/New_York',
    // Every day: every 2 hours, 7 AM–11 PM ET (7 AM brief covers midnight→7 AM)
    daily: { start: 7, end: 23, intervalHours: 2, openingHour: 7 },
  },

  history: {
    maxEntries: 8, // recentBriefs / recentTweets rolling window in state.json
  },

  dedup: {
    shingleSize: 3, // word-shingle size for near-dup detection
    // Strict on purpose: bias toward under-collapsing (a few near-dupes
    // slip through) rather than over-collapsing (a real story update
    // gets mistaken for a duplicate of the earlier tweet).
    jaccardThreshold: 0.85,
    // Looser than jaccardThreshold on purpose: this compares condensed,
    // paraphrased one-sentence brief bullets across runs, not near-identical
    // raw tweet text — the same story reworded by the model has much lower
    // shingle overlap than two near-duplicate tweets ever would.
    storyJaccardThreshold: 0.5,
  },
};

module.exports = config;
