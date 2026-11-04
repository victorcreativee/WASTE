#!/usr/bin/env bash
# Read-only production operations check. Intended for cron every five minutes.
# It verifies containers, public readiness, backup freshness/checksum and disk headroom.
# Alerts are sent only when state changes (healthy -> failed or failed -> recovered).
set -euo pipefail

if [[ -n "${KWMS_ROOT:-}" ]]; then cd "$KWMS_ROOT"; else cd "$(dirname "$0")/../.."; fi

ENV_FILE="infrastructure/production/.env"
COMPOSE_FILE="infrastructure/production/compose.yaml"
BACKUP_DIR="${BACKUP_DIR:-backups}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-30}"
MAX_DISK_PERCENT="${MAX_DISK_PERCENT:-85}"
STATE_DIR="${OPS_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/kampala-wms}"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: Missing $ENV_FILE"; exit 1; }
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

# Avoid overlapping cron checks when a network request is slow.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/operations-check.lock"
  flock -n 9 || exit 0
fi

env_value() {
  local key="$1" value
  value="$(grep -m1 "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
  value="${value%\"}"; value="${value#\"}"
  printf '%s' "$value"
}

configured_backup_age="$(env_value MAX_BACKUP_AGE_HOURS)"
configured_disk_percent="$(env_value MAX_DISK_PERCENT)"
[[ -n "$configured_backup_age" ]] && MAX_BACKUP_AGE_HOURS="$configured_backup_age"
[[ -n "$configured_disk_percent" ]] && MAX_DISK_PERCENT="$configured_disk_percent"
[[ "$MAX_BACKUP_AGE_HOURS" =~ ^[0-9]+$ ]] || { echo "ERROR: MAX_BACKUP_AGE_HOURS must be an integer"; exit 1; }
[[ "$MAX_DISK_PERCENT" =~ ^[0-9]+$ && "$MAX_DISK_PERCENT" -gt 0 && "$MAX_DISK_PERCENT" -le 100 ]] \
  || { echo "ERROR: MAX_DISK_PERCENT must be an integer from 1 to 100"; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
issues=()
required_services=(database redis auth-service organization-service waste-service api-gateway admin-web)
running="$(compose ps --status running --services 2>/dev/null || true)"
for service in "${required_services[@]}"; do
  grep -qx "$service" <<<"$running" || issues+=("container is not running: $service")
done

public_url="$(env_value PUBLIC_APP_URL)"
if [[ -z "$public_url" ]]; then
  issues+=("PUBLIC_APP_URL is not configured")
else
  public_url="${public_url%/}"
  for path in / /api/health /api/auth/ready /api/organizations/ready /api/waste/ready; do
    code="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 15 "$public_url$path" 2>/dev/null || true)"
    [[ "$code" == "200" ]] || issues+=("public check failed ($code): $path")
  done
fi

latest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'kampala_wms-*.dump' -type f -print 2>/dev/null | sort | tail -1)"
if [[ -z "$latest" ]]; then
  issues+=("no database backup exists")
else
  if stat -c %Y "$latest" >/dev/null 2>&1; then modified="$(stat -c %Y "$latest")"; else modified="$(stat -f %m "$latest")"; fi
  age_hours=$(( ( $(date +%s) - modified ) / 3600 ))
  (( age_hours <= MAX_BACKUP_AGE_HOURS )) || issues+=("latest database backup is ${age_hours} hours old")
  if [[ ! -s "$latest" ]]; then
    issues+=("latest database backup is empty")
  elif [[ ! -f "$latest.sha256" ]]; then
    issues+=("latest database backup has no checksum")
  elif command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$latest")" && sha256sum -c "$(basename "$latest.sha256")" >/dev/null 2>&1) || issues+=("latest database backup checksum failed")
  fi
fi

disk_percent="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ "$disk_percent" =~ ^[0-9]+$ ]]; then
  (( disk_percent < MAX_DISK_PERCENT )) || issues+=("server disk usage is ${disk_percent}%")
else
  issues+=("could not read server disk usage")
fi

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"; value="${value//\"/\\\"}"; value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

send_email() {
  local subject="$1" body="$2" key from recipient payload
  key="$(env_value RESEND_API_KEY)"; from="$(env_value NOTIFY_EMAIL_FROM)"; recipient="$(env_value OPS_ALERT_EMAIL)"
  [[ -n "$key" && -n "$from" && -n "$recipient" ]] || { echo "WARNING: Operations email alert is not configured"; return 0; }
  payload="$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
    "$(json_escape "$from")" "$(json_escape "$recipient")" "$(json_escape "$subject")" "$(json_escape "$body")")"
  curl -fsS --max-time 15 https://api.resend.com/emails \
    -H "Authorization: Bearer $key" -H 'Content-Type: application/json' -d "$payload" >/dev/null \
    || echo "WARNING: Could not deliver operations alert"
}

state_file="$STATE_DIR/operations-check.state"
previous="$(cat "$state_file" 2>/dev/null || true)"
checked_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
if (( ${#issues[@]} )); then
  printf 'FAIL %s\n' "$checked_at"
  printf ' - %s\n' "${issues[@]}"
  if [[ "$previous" != "failed" ]]; then
    details="$(printf -- '- %s\n' "${issues[@]}")"
    body="$(printf 'The production operations check failed at %s.\n\n%s\nInspect the server before recording more business transactions.' "$checked_at" "$details")"
    send_email "Kampala WMS production check failed" "$body"
  fi
  printf 'failed' > "$state_file"
  exit 1
fi

echo "PASS $checked_at — services, public endpoints, backup and disk are healthy"
if [[ "$previous" == "failed" ]]; then
  send_email "Kampala WMS production recovered" "The production operations check recovered at $checked_at. Services, public endpoints, backup and disk are healthy again."
fi
printf 'healthy' > "$state_file"

