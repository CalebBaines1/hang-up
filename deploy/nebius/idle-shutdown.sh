#!/bin/sh
# Runs every minute from cron on the VM. Powers the VM off after IDLE_MINUTES
# with no app activity and no live call, so it only bills while someone uses it.
# The web app on Vercel starts it again on the next visit (apps/web/api/wake.ts).
IDLE_MINUTES=${IDLE_MINUTES:-20}

# Give a fresh boot (or the first build) time before judging idleness.
[ "$(cut -d. -f1 /proc/uptime)" -lt 900 ] && exit 0

# API not answering (still starting or rebuilding): leave the VM alone.
R=$(curl -fsS -m 5 http://127.0.0.1:8787/api/activity) || exit 0
IDLE=$(echo "$R" | sed -n 's/.*"idleSeconds":\([0-9]*\).*/\1/p')
ACTIVE=$(echo "$R" | sed -n 's/.*"activeCalls":\([0-9]*\).*/\1/p')

if [ "${ACTIVE:-1}" -eq 0 ] && [ "${IDLE:-0}" -ge $((IDLE_MINUTES * 60)) ]; then
  logger "hang-up: idle for ${IDLE}s, powering off"
  shutdown -h now
fi
