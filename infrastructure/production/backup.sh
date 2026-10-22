#!/usr/bin/env bash
# Nightly PostgreSQL backup for the production compose stack.
# Read-only for the database: uses pg_dump (consistent snapshot, no locks on normal writes).
#
#   infrastructure/production/backup.sh               # writes to ./backups (or $BACKUP_DIR)
#   BACKUP_DIR=/srv/kwms-backups KEEP_DAYS=30 infrastructure/production/backup.sh
#
# Schedule (example, server crontab, 02:15 daily):
#   15 2 * * * cd /path/to/WASTE && infrastructure/production/backup.sh >> /var/log/kwms-backup.log 2>&1
#
# Restore into an EMPTY database (test this regularly on a staging copy):
#   docker compose --env-file infrastructure/production/.env -f infrastructure/production/compose.yaml \
#     exec -T database sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
#     < backups/kampala_wms-YYYYmmdd-HHMMSS.dump
#
# Copy backups off the server (object storage or another machine): a backup on the same disk
# does not survive a disk or server loss.
set -euo pipefail

cd "$(dirname "$0")/../.."

ENV_FILE="infrastructure/production/.env"
COMPOSE_FILE="infrastructure/production/compose.yaml"
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/kampala_wms-$stamp.dump"
partial="$target.partial"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 --no-owner' > "$partial"

# A truncated or empty dump must never replace a good one.
if [[ ! -s "$partial" ]]; then
  rm -f "$partial"
  echo "ERROR: Backup is empty"
  exit 1
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T database sh -c 'pg_restore --list > /dev/null' < "$partial"

mv "$partial" "$target"
chmod 600 "$target"
echo "Backup written: $target ($(du -h "$target" | cut -f1))"

find "$BACKUP_DIR" -name 'kampala_wms-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete
