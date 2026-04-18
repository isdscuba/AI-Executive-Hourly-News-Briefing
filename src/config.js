'use strict';

require('dotenv').config();

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
    // Weekday: every hour, 6 AM–11 PM ET (6 AM brief covers midnight→6 AM)
    weekday: { start: 6, end: 23, openingHour: 6 },
    // Weekend: every 2 hours, 7 AM–11 PM ET (7 AM brief covers midnight→7 AM)
    weekend: { start: 7, end: 23, intervalHours: 2, openingHour: 7 },
  },
};

module.exports = config;
