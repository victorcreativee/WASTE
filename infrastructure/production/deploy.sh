#!/usr/bin/env bash
# Deploys a release in a safe order:
#   1. build images            4. apply migrations (migrate.sh)
#   2. start database + redis  5. start or restart every service
#   3. back up the database    6. confirm every service reports ready (all required tables present)
# Stops at the first failure. Run from anywhere: infrastructure/production/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE="infrastructure/production/.env"
COMPOSE_FILE="infrastructure/production/compose.yaml"
compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

[[ -f "$ENV_FILE" ]] || { echo "ERROR: Missing $ENV_FILE (copy .env.example and fill it in)"; exit 1; }
grep -q '^PUBLIC_APP_URL=.\+' "$ENV_FILE" || echo "WARNING: PUBLIC_APP_URL is empty; certificate QR codes will point to localhost."

echo "1/6 Building images..."
compose build

echo "2/6 Starting database and redis..."
compose up -d database redis
for _ in $(seq 1 60); do
  compose exec -T database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break
  sleep 2
done

echo "3/6 Backing up the database before migrating..."
if [[ "${SKIP_BACKUP:-}" == "1" ]]; then echo "   skipped (SKIP_BACKUP=1)"; else infrastructure/production/backup.sh; fi

echo "4/6 Applying migrations..."
infrastructure/production/migrate.sh

echo "5/6 Starting services..."
compose up -d

echo "6/6 Waiting for every service to report ready..."
ready() { compose exec -T "$1" node -e "fetch('http://127.0.0.1:$2$3/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; }
for target in "auth-service 8091 /api/auth" "organization-service 8092 /api/organizations" "waste-service 8093 /api/waste"; do
  read -r service port prefix <<<"$target"
  for attempt in $(seq 1 30); do
    if ready "$service" "$port" "$prefix"; then echo "   $service ready"; break; fi
    if [[ "$attempt" == 30 ]]; then
      echo "ERROR: $service is not ready. Details:"
      compose exec -T "$service" node -e "fetch('http://127.0.0.1:$port$prefix/ready').then(r=>r.text()).then(console.log)" || true
      exit 1
    fi
    sleep 3
  done
done
echo "Release deployed."
