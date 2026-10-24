#!/bin/sh
# Runs every minute from cron on the VM. Stops the VM after IDLE_MINUTES with
# no app activity and no live call, so compute only bills while someone uses it.
# The web app on Vercel starts it again on the next visit (apps/web/api/wake.ts).
#
# A Linux `shutdown` is treated by Nebius as a crash (the VM reboots and keeps
# billing), so this stops the VM through the Nebius API, using the service
# account attached to the VM via the instance metadata service.
IDLE_MINUTES=${IDLE_MINUTES:-20}
IMDS=http://metadata.nebius.internal

# Give a fresh boot (or the first build) time before judging idleness.
[ "$(cut -d. -f1 /proc/uptime)" -lt 900 ] && exit 0

# API not answering (still starting or rebuilding): leave the VM alone.
R=$(curl -fsS -m 5 http://127.0.0.1:8787/api/activity) || exit 0
IDLE=$(echo "$R" | sed -n 's/.*"idleSeconds":\([0-9]*\).*/\1/p')
ACTIVE=$(echo "$R" | sed -n 's/.*"activeCalls":\([0-9]*\).*/\1/p')
[ "${ACTIVE:-1}" -eq 0 ] && [ "${IDLE:-0}" -ge $((IDLE_MINUTES * 60)) ] || exit 0

TOKEN=$(curl -fsS -m 5 -H "Metadata: true" $IMDS/v1/iam/sa/token/access_token) || {
  logger "hang-up: idle but no service account attached to the VM; can't stop it"
  exit 0
}
ID=$(curl -fsS -m 5 -H "Metadata: true" $IMDS/v1/instance-data | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -1)
logger "hang-up: idle for ${IDLE}s, stopping VM $ID"
curl -fsS -m 20 -X POST https://api.nebius.cloud/compute/v1/instances/stop \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"$ID\"}" >/dev/null || logger "hang-up: stop request failed"
