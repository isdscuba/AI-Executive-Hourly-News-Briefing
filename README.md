# AI Executive Briefing

Runs on your Mac. Every hour, it pulls tweets from 40+ curated accounts across 5 parallel batches, strips the payloads to bare essentials, sends them to Gemini, and delivers a concise intelligence brief to Telegram.

No cloud required. No subscriptions. Costs about $0.48/month in API calls.

## What it monitors

The service tracks 40 accounts across 5 batches, all fetched in parallel:

| Batch | Accounts |
|-------|----------|
| News & Analysis | nexta_tv, zerohedge, lookner, ariehkovler, RonFilipkowski, maggieNYT, TreyYingst |
| Intel & OSINT | Osint613, sentdefender, IntelCrab, bellingcat, ELINTNews, AuroraIntel, IntelPointAlert, JakeTapper |
| Military & Aviation | IntelDoge, IntelSky, AircraftSpots, air_intel, Global_MIL_Info, Osinttechnical, WarSpotting, MT_Anderson |
| Middle East | EretzIsrael, gaza_report, Israel_Alma_org, IsraelRadar_com, rawsalerts, DanWilliams, Tendar, FinancialJuice, AvivaKlompas, BBCBreaking |
| Major Outlets | CNNBrk, Reuters, AP, WSJbreakingnews, AJEnglish |

### Changing the accounts

Edit `src/config.js`. The `batches` array holds 5 sub-arrays — one per parallel request. Each account is a Twitter username string (no `@`).

```js
batches: [
  ['nexta_tv', 'zerohedge', 'lookner', ...],  // batch 1
  ['Osint613', 'sentdefender', ...],           // batch 2
  // ...
],
```

Keep batches balanced — the service waits for all 5 to finish before generating the brief. If one batch has 20 accounts and another has 2, you're bottlenecked on the big one.

## Tech

- **Twitter data**: [twitterapi.io](https://twitterapi.io) — a third-party Twitter API provider, not the official Twitter API. Cheaper and less restrictive for read-only use.
- **AI summarization**: Gemini 2.5 Flash-Lite (`thinkingBudget=0` — fast, no extended reasoning)
- **Delivery**: Telegram Bot API
- **Scheduler**: `node-cron` running on the local machine
- **Dedup**: Last 2 briefs stored in `data/briefings.json` — prevents re-reporting the same stories

## Setup

### 1. Prerequisites

- Node.js 18+ on your Mac
- A twitterapi.io account and API key
- A Gemini API key (Google AI Studio — free tier works)
- A Telegram bot token and your chat ID

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

```
TWITTER_API_KEY=       # from twitterapi.io dashboard
GEMINI_API_KEY=        # from aistudio.google.com
TELEGRAM_BOT_TOKEN=    # from @BotFather on Telegram
TELEGRAM_CHAT_ID=      # from @userinfobot on Telegram
```

### 4. Test

```bash
npm run run-once
```

Runs one cycle immediately, bypassing the schedule window. Check Telegram for the brief.

### 5. Run as a background daemon (Mac)

Copy the example plist, fill in your actual paths, and load it:

```bash
# 1. Copy the example
cp exec-briefing.plist.example exec-briefing.plist

# 2. Edit exec-briefing.plist — update these two values:
#    /path/to/node         → output of: which node
#    /path/to/executive-news  → full path to this folder

# 3. Find your Node path
which node

# 4. Create the logs directory
mkdir -p ~/Library/Logs/exec-briefing

# 5. Install the daemon
cp exec-briefing.plist ~/Library/LaunchAgents/com.exec-briefing.plist
launchctl load ~/Library/LaunchAgents/com.exec-briefing.plist

# 6. Verify
launchctl list | grep exec-briefing

# 7. Watch logs
tail -f ~/Library/Logs/exec-briefing/stdout.log
```

To stop it:
```bash
launchctl unload ~/Library/LaunchAgents/com.exec-briefing.plist
```

## Changing the schedule

Edit `src/config.js`:

```js
schedule: {
  timezone: 'America/New_York',
  // Weekdays: runs every hour between these times
  weekday: { start: 6, end: 23, openingHour: 6 },
  // Weekends: runs every 2 hours between these times
  weekend: { start: 7, end: 23, intervalHours: 2, openingHour: 7 },
},
```

`start` and `end` are hours in 24h format. The `openingHour` brief covers everything from midnight to the first run. Change `timezone` to any [IANA timezone string](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) — e.g., `'Europe/London'` or `'Asia/Dubai'`.

After editing, restart the daemon:
```bash
launchctl unload ~/Library/LaunchAgents/com.exec-briefing.plist
launchctl load ~/Library/LaunchAgents/com.exec-briefing.plist
```

## Architecture

```
node-cron (schedule check)
  → 5x twitterapi.io requests (parallel, last 1hr window)
  → strip to {text, createdAt, author}  ←  ~95% token reduction
  → load data/briefings.json (last 2 briefs, for dedup)
  → Gemini 2.5 Flash-Lite
  → Telegram sendMessage
  → save to data/briefings.json (keep last 2)
```

**Cost**: ~$0.48/month at current Gemini pricing vs ~$53/month for equivalent cloud automation.

## Running in the cloud (optional)

The service is designed for local use, but it runs fine on any Linux server or VPS if you want 24/7 uptime independent of your Mac.

### Option A: Linux VPS (DigitalOcean, Hetzner, etc.)

```bash
# On the server
git clone https://github.com/isdscuba/ai-executive-briefing.git
cd ai-executive-briefing
npm install
cp .env.example .env
# fill in .env with your keys

# Run with pm2 (keeps it alive on restart)
npm install -g pm2
pm2 start src/index.js --name exec-briefing
pm2 save
pm2 startup  # follow the output instructions to survive reboots
```

### Option B: Railway / Render (free tiers available)

Both platforms support Node.js deployments directly from GitHub. Connect the repo, add your env vars in the dashboard, and set the start command to `node src/index.js`. Railway's free tier ($5 credit/month) covers this service's usage comfortably.

### Option C: Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "src/index.js"]
```

```bash
docker build -t exec-briefing .
docker run -d --restart always --env-file .env exec-briefing
```

## Development

```bash
npm test               # all tests
npm run test:unit      # unit tests only
npm run test:coverage  # with coverage report
npm run test:watch     # watch mode
```

## License

MIT
