# Exec News Briefing

Hourly executive intelligence briefing delivered via Telegram. Replaces Make.com scenario 2587261.

Fetches tweets from 5 account batches, strips payloads to minimal fields (~95% token reduction), generates a brief via Gemini 2.5 Flash-Lite, and delivers it to Telegram.

## Setup

### 1. Prerequisites
- Node.js >=18 on the Mac Mini
- API credentials (see below)

### 2. Install
```bash
npm install
```

### 3. Configure
```bash
cp .env.example .env
# Fill in: TWITTER_API_KEY, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN
```

**Credential sources:**
| Key | Source |
|-----|--------|
| `TWITTER_API_KEY` | Already in the original Make.com blueprint |
| `GEMINI_API_KEY` | Extract from Make.com connection 6843026 |
| `TELEGRAM_BOT_TOKEN` | Extract from Make.com connection 3570383 |

No Airtable required — previous briefings are stored locally in `data/briefings.json`.

### 4. Test manually
```bash
npm run run-once
```
Check your Telegram chat for the briefing. This bypasses the 6AM–10PM run window.

### 5. Deploy as launchd daemon

First, find your Node.js path:
```bash
which node
```

Update `com.ilan.exec-briefing.plist` with the correct paths for `node` and the project directory, then:

```bash
# Create logs directory
mkdir -p logs

# Copy plist to LaunchAgents
cp com.ilan.exec-briefing.plist ~/Library/LaunchAgents/

# Load the daemon
launchctl load ~/Library/LaunchAgents/com.ilan.exec-briefing.plist

# Verify it's running
launchctl list | grep exec-briefing

# Watch logs
tail -f logs/stdout.log
```

## Development

```bash
npm test               # Run all tests
npm run test:unit      # Unit tests only
npm run test:coverage  # With coverage report
npm run test:watch     # Watch mode
```

## Architecture

```
cron (node-cron)
  → 5× twitterapi.io (parallel, 1hr window)
  → strip to {text, createdAt, author} only  ← ~95% token reduction
  → load data/briefings.json (last 2 briefs, for dedup)
  → Gemini 2.5 Flash-Lite (thinkingBudget=0)
  → Telegram sendMessage
  → save to data/briefings.json (rotate, keep 2)
```

**Run window:** 6:00 AM – 10:00 PM ET
**Model:** `gemini-2.5-flash-lite` — $0.10/1M input, $0.40/1M output (~$0.48/month vs $53/month with Make.com)

## Deactivate Make.com

Once validated (24h parallel run), deactivate Make.com scenario 2587261 to stop double-sending.
