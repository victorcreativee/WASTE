#!/usr/bin/env bash
# Installs an idempotent per-user production schedule without changing other cron jobs.
# Server timezone is UTC: 23:15 UTC = 02:15 Africa/Kampala; 00:30 UTC = 03:30 Africa/Kampala.
set -euo pipefail

cd "$(dirname "$0")/../.."
root="$PWD"
begin="# BEGIN KAMPALA_WMS_OPERATIONS"
end="# END KAMPALA_WMS_OPERATIONS"
existing="$(crontab -l 2>/dev/null || true)"
cleaned="$(awk -v begin="$begin" -v end="$end" '
  $0 == begin {skip=1; next}
  $0 == end {skip=0; next}
  !skip {print}
' <<<"$existing")"

schedule="$(cat <<EOF
$begin
# Times are UTC. Backups run at 02:15 Kampala time and restore rehearsal at 03:30 Kampala time.
15 23 * * * cd $root && infrastructure/production/backup.sh 2>&1 | /usr/bin/logger -t kwms-backup
30 0 * * 0 cd $root && infrastructure/production/verify-backup.sh 2>&1 | /usr/bin/logger -t kwms-restore-check
*/5 * * * * cd $root && infrastructure/production/operations-check.sh 2>&1 | /usr/bin/logger -t kwms-operations-check
$end
EOF
)"

{ printf '%s\n' "$cleaned"; printf '%s\n' "$schedule"; } | awk 'NF || previous {print} {previous=NF}' | crontab -
echo "Installed Kampala WMS operations schedule:"
crontab -l | sed -n "/$begin/,/$end/p"

