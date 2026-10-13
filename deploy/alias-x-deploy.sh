#!/bin/bash
# alias-x deploy script. Installed on the VM as /usr/local/bin/alias-x-deploy and run as root
# (via sudo, forced by the deploy user's SSH key).
#
# stdin: line 1 = 40-character git commit SHA, the rest = release.tar.gz (a `git archive` of that commit).
# Steps: back up the database -> unpack and install beside the live app -> swap -> restart
#        -> health check -> roll back to the previous version if the check fails.
#
# Note: the new code applies any new migrations when it starts. Keep migrations additive so a
# rollback to the previous code still works against the migrated database.
set -euo pipefail

APP=/opt/alias-x
NEW=/opt/alias-x.new
PREV=/opt/alias-x.prev
FAILED=/opt/alias-x.failed
HEALTH=http://127.0.0.1:8787/health
MAX_BYTES=104857600   # 100 MB cap on the archive

exec 9>/var/lock/alias-x-deploy.lock
flock -n 9 || { echo "another deploy is running" >&2; exit 1; }

IFS= read -r SHA || { echo "missing commit sha" >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "bad commit sha" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
head -c "$MAX_BYTES" > "$WORK/release.tar.gz"
tar -tzf "$WORK/release.tar.gz" > /dev/null || { echo "not a valid archive" >&2; exit 1; }

echo "Deploying $SHA"

echo "1/5 backing up the database"
/usr/local/bin/alias-x-backup.sh

echo "2/5 unpacking and installing dependencies"
rm -rf "$NEW"
mkdir "$NEW"
tar -xzf "$WORK/release.tar.gz" -C "$NEW" --no-same-owner
test -f "$NEW/src/main.ts" || { echo "archive has no src/main.ts" >&2; exit 1; }
echo "$SHA" > "$NEW/.release"
chown -R aliasx:aliasx "$NEW"
runuser -u aliasx -- env HOME=/tmp npm_config_cache=/tmp/alias-x-npm-cache \
  bash -c 'cd "$1" && npm ci --omit=dev --no-audit --no-fund' _ "$NEW"

echo "3/5 swapping versions"
systemctl stop alias-x
rm -rf "$PREV"
mv "$APP" "$PREV"
mv "$NEW" "$APP"

echo "4/5 starting"
systemctl reset-failed alias-x 2>/dev/null || true
systemctl start alias-x

echo "5/5 health check"
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH" 2>/dev/null | grep -q '"status":"ready"'; then
    echo "healthy: $SHA"
    exit 0
  fi
  sleep 1
done

echo "health check failed, rolling back to the previous version" >&2
systemctl stop alias-x || true
rm -rf "$FAILED"
mv "$APP" "$FAILED"
mv "$PREV" "$APP"
# A crash-looping version can trip systemd's restart limit; clear it so the old version can start.
systemctl reset-failed alias-x 2>/dev/null || true
systemctl start alias-x
exit 1
