# executive-news — Claude Code Rules

## After every change

1. Commit to git with a descriptive message.
2. Push to remote (`git push`).
3. Restart the service: `launchctl unload ~/Library/LaunchAgents/com.ilan.exec-briefing.plist && launchctl load ~/Library/LaunchAgents/com.ilan.exec-briefing.plist` — do NOT use `kickstart -k` as it breaks the cron timer.
4. Verify it is working (check logs, confirm next pipeline run succeeds, or run a manual test as appropriate).

Never report a change as done until all four steps are complete.
