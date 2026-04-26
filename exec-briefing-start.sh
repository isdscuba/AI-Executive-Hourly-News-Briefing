#!/bin/bash
# Waits for the external drive to mount, then starts the exec-briefing node daemon.
# Install to: ~/Library/Scripts/exec-briefing-start.sh (chmod +x)
WORK_DIR="/Volumes/home/Drive/APPS/executive-news"
NODE="/opt/homebrew/opt/node@22/bin/node"
SCRIPT="$WORK_DIR/src/index.js"
MAX_WAIT=120
waited=0

while [ ! -f "$SCRIPT" ] && [ "$waited" -lt "$MAX_WAIT" ]; do
  sleep 5
  waited=$((waited + 5))
done

if [ ! -f "$SCRIPT" ]; then
  echo "$(date): Volume not available after ${MAX_WAIT}s — aborting" >&2
  exit 1
fi

exec "$NODE" "$SCRIPT"
