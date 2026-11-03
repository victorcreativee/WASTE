#!/usr/bin/env bash
# Restores a production backup into a disposable database, verifies the
# application schema, then removes the database. It never connects to or
# modifies the live application database.
set -euo pipefail

cd "$(dirname "$0")/../.."

ENV_FILE="infrastructure/production/.env"
COMPOSE_FILE="infrastructure/production/compose.yaml"
BACKUP_DIR="${BACKUP_DIR:-backups}"
requested="${1:-}"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: Missing $ENV_FILE"; exit 1; }

if [[ -n "$requested" ]]; then
  backup="$requested"
else
  backup="$(find "$BACKUP_DIR" -maxdepth 1 -name 'kampala_wms-*.dump' -type f -print | sort | tail -1)"
fi

[[ -n "${backup:-}" && -f "$backup" && -s "$backup" ]] || { echo "ERROR: No non-empty backup was found"; exit 1; }
case "$(basename "$backup")" in
  kampala_wms-*.dump) ;;
  *) echo "ERROR: Refusing unexpected backup filename: $backup"; exit 1 ;;
esac

if [[ -f "$backup.sha256" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$backup")" && sha256sum -c "$(basename "$backup.sha256")")
  elif command -v shasum >/dev/null 2>&1; then
    expected="$(awk '{print $1}' "$backup.sha256")"
    actual="$(shasum -a 256 "$backup" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || { echo "ERROR: Backup checksum does not match"; exit 1; }
  else
    echo "ERROR: sha256sum or shasum is required to verify this backup"
    exit 1
  fi
else
  echo "WARNING: No checksum exists for this older backup; restore validation will continue."
fi

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
restore_db="kwms_restore_check_$(date +%Y%m%d%H%M%S)_$$"
[[ "$restore_db" =~ ^kwms_restore_check_[0-9_]+$ ]] || { echo "ERROR: Unsafe restore database name"; exit 1; }

cleanup() {
  compose exec -T database sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists '$restore_db'" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

compose exec -T database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null
compose exec -T database sh -c "createdb -U \"\$POSTGRES_USER\" '$restore_db'"
compose exec -T database sh -c "pg_restore -U \"\$POSTGRES_USER\" -d '$restore_db' --exit-on-error --no-owner --no-privileges" < "$backup"

result="$(compose exec -T database sh -c "psql -U \"\$POSTGRES_USER\" -d '$restore_db' -v ON_ERROR_STOP=1 -At" <<'SQL'
DO $$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'organizations','users','schema_migrations','recycling_material_lots',
    'recycling_material_sales','recycling_manager_float_transactions',
    'recycling_cash_movements','desktop_sync_requests'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'required table missing: %', required_table;
    END IF;
  END LOOP;
END $$;
SELECT 'schema_migrations=' || COUNT(*) FROM schema_migrations;
SELECT 'recycling_organizations=' || COUNT(*) FROM organizations WHERE type='recycling_company';
SELECT 'recycling_purchases=' || COUNT(*) FROM recycling_material_lots WHERE origin='purchase';
SELECT 'recycling_sales=' || COUNT(*) FROM recycling_material_sales;
SELECT 'cash_position_function=' || CASE WHEN to_regprocedure('organization_cash_position(uuid)') IS NULL THEN 'missing' ELSE 'present' END;
SQL
)"

grep -q '^cash_position_function=present$' <<<"$result" || { echo "ERROR: Required finance function is missing"; exit 1; }
echo "Backup restore verified in disposable database: $(basename "$backup")"
printf '%s\n' "$result"
