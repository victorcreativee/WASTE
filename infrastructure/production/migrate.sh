#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

ENV_FILE="infrastructure/production/.env"
COMPOSE_FILE="infrastructure/production/compose.yaml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE"
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Checking PostgreSQL availability..."

compose exec -T database sh -c \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "Creating migration history table..."

compose exec -T database sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

for file in infrastructure/database/[0-9][0-9][0-9]_*.sql; do
  filename="$(basename "$file")"
  checksum="$(shasum -a 256 "$file" | awk '{print $1}')"

  recorded="$(
    printf "SELECT checksum FROM schema_migrations WHERE filename = '%s';\n" "$filename" |
      compose exec -T database sh -c         'psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  )"

  if [[ -n "$recorded" ]]; then
    if [[ "$recorded" != "$checksum" ]]; then
      echo "ERROR: Migration checksum mismatch: $filename"
      exit 1
    fi
    echo "SKIP: $filename"
    continue
  fi

  echo "APPLY: $filename"

  {
    echo "BEGIN;"
    cat "$file"
    printf '\n'
    printf "INSERT INTO schema_migrations (filename, checksum) VALUES ('%s', '%s');\n" "$filename" "$checksum"
    echo "COMMIT;"
  } | compose exec -T database sh -c \
    'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

  echo "DONE: $filename"
done

echo "All database migrations processed successfully."
