#!/usr/bin/env bash
# Applies every migration to a brand-new PostGIS database exactly as infrastructure/production/migrate.sh does
# (init.sql via the image's init directory, then each NNN_*.sql in its own transaction). It then re-applies the
# migrations from RERUN_FROM (default 092) to prove those are safe to repeat. Older migrations are not written to be
# re-run (073 drops a constraint others depend on); production never re-runs them because migrate.sh records each one.
# The throwaway container is always removed.
#
#   scripts/verify-migrations.sh            # uses postgis/postgis:16-3.4 (the production image)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${POSTGIS_IMAGE:-postgis/postgis:16-3.4}"
NAME="wms-migration-check-$$"
DB=wms_check
USER_NAME=wms_check

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting a fresh $IMAGE database..."
docker run -d --name "$NAME" \
  -e POSTGRES_DB="$DB" -e POSTGRES_USER="$USER_NAME" -e POSTGRES_PASSWORD=check \
  -v "$PWD/infrastructure/database/init.sql:/docker-entrypoint-initdb.d/001-init.sql:ro" \
  "$IMAGE" >/dev/null

# The image restarts PostgreSQL once after running init scripts; wait for the final server.
for _ in $(seq 1 60); do
  if docker exec "$NAME" sh -c "pg_isready -U $USER_NAME -d $DB -h 127.0.0.1" >/dev/null 2>&1 \
     && docker logs "$NAME" 2>&1 | grep -q "PostgreSQL init process complete"; then break; fi
  sleep 1
done
sleep 2

psql_run() { docker exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U "$USER_NAME" -d "$DB" "$@"; }

RERUN_FROM="${RERUN_FROM:-092}"

apply_all() {
  local pass="$1" from="${2:-000}" count=0
  for file in infrastructure/database/[0-9][0-9][0-9]_*.sql; do
    [[ "$(basename "$file" | cut -c1-3)" < "$from" ]] && continue
    if ! { echo "BEGIN;"; cat "$file"; printf '\nCOMMIT;\n'; } | psql_run >/tmp/wms-migration-$$.log 2>&1; then
      echo "FAILED ($pass): $(basename "$file")"
      cat /tmp/wms-migration-$$.log
      exit 1
    fi
    count=$((count + 1))
  done
  echo "Pass $pass: $count migrations applied."
}

apply_all "first run"
apply_all "re-run from $RERUN_FROM" "$RERUN_FROM"

echo "Checking key objects..."
report="$(psql_run -At <<'SQL'
SELECT 'tables: '||count(*) FROM information_schema.tables WHERE table_schema='public';
SELECT 'missing: '||COALESCE(string_agg(t,', '),'none') FROM unnest(ARRAY[
  'organization_permit_activities','permit_renewal_requests','permit_lifecycle_notices',
  'regulatory_returns','regulatory_return_history','city_reports','kcca_service_standards','user_sessions','factory_intakes','factory_batches','factory_dispatches','notifications','notification_preferences','notification_deliveries','disposal_facilities','trip_disposal_explanations','dumping_sites','dumping_reports','dumping_photos','dumping_site_history','penalty_schedule','penalty_notices','penalty_appeals','penalty_history','trip_track_checks','organization_subscriptions','subscription_invoices','subscription_events'
]) t WHERE to_regclass(t) IS NULL;
SELECT 'divisions: '||count(*) FROM kampala_divisions;
SELECT 'permit activities: '||count(*) FROM permit_activity_types;
SQL
)"
echo "$report"
if ! grep -q '^missing: none$' <<<"$report"; then echo "Key objects are missing."; exit 1; fi
rm -f /tmp/wms-migration-$$.log
echo "Migrations verified on a fresh database."
