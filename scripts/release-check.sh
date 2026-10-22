#!/usr/bin/env bash
# KCCA Command Center release gate. Runs, in order, and stops at the first failure:
#   1. type checks (gateway, three services, admin web)     5. migrations on a fresh PostGIS database
#   2. unit tests (auth, waste)                             6. end-to-end suites against local test instances
#   3. production dependency audit (no critical/high,          (ports 8191 auth, 8193 waste; local database only)
#      except the documented gateway exception)
#   4. admin-web production build
#
#   scripts/release-check.sh                 # everything
#   SKIP_WEB_BUILD=1 SKIP_E2E=1 scripts/release-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
LOGS="$(mktemp -d)"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true; done
  # The subshells start node through npx; stop whatever this script left listening on its test ports.
  if [[ "${STARTED_TEST_SERVERS:-}" == "1" ]]; then
    for port in 8191 8193; do lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; done
  fi
}
trap cleanup EXIT
step() { printf '\n== %s\n' "$1"; }

step "1. Type checks"
for pkg in apps/api-gateway services/auth-service services/organization-service services/waste-service apps/admin-web; do
  (cd "$pkg" && npx tsc --noEmit -p .) && echo "   ok  $pkg"
done

step "2. Unit tests"
for pkg in services/auth-service services/waste-service; do
  out="$(cd "$pkg" && npm test 2>&1)" || { echo "$out" | tail -40; echo "FAILED: $pkg unit tests"; exit 1; }
  echo "   ok  $pkg ($(grep -E '^# pass' <<<"$out" | awk '{print $3}') passed)"
done

step "3. Dependency audit (production dependencies)"
# braces <=3.0.3 (via http-proxy-middleware) has no fixed release; the gateway only matches fixed route patterns, so the
# stack-exhaustion issue needs attacker-controlled globs it never receives. Re-check when braces publishes a fix.
ALLOWED_GATEWAY="braces http-proxy-middleware micromatch"
for pkg in apps/api-gateway services/auth-service services/organization-service services/waste-service apps/admin-web; do
  findings="$(cd "$pkg" && { npm audit --omit=dev --json 2>/dev/null || true; } | node -e '
    const a=JSON.parse(require("fs").readFileSync(0));
    console.log(Object.entries(a.vulnerabilities||{}).filter(([,v])=>["critical","high"].includes(v.severity)).map(([n])=>n).sort().join(" "));')"
  if [[ -n "$findings" && !( "$pkg" == "apps/api-gateway" && "$findings" == "$ALLOWED_GATEWAY" ) ]]; then
    echo "FAILED: $pkg has critical/high advisories: $findings"; exit 1
  fi
  echo "   ok  $pkg${findings:+ (accepted: $findings)}"
done

if [[ "${SKIP_WEB_BUILD:-}" != "1" ]]; then
  step "4. Admin web production build"
  (cd apps/admin-web && npm run build >"$LOGS/web-build.log" 2>&1) || { tail -40 "$LOGS/web-build.log"; echo "FAILED: admin-web build"; exit 1; }
  [[ -f apps/admin-web/.next/standalone/apps/admin-web/server.js ]] || { echo "FAILED: standalone server not at the path the desktop app loads"; exit 1; }
  echo "   ok  $(grep -Eo 'Generating static pages[^)]*\([0-9/]+\)' "$LOGS/web-build.log" | tail -1)"
fi

step "5. Migrations on a fresh database"
scripts/verify-migrations.sh

if [[ "${SKIP_E2E:-}" != "1" ]]; then
  step "6. End-to-end suites"
  for port in 8191 8193; do
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "FAILED: port $port is in use; stop the process using it first"; exit 1; fi
  done
  STARTED_TEST_SERVERS=1
  (cd services/auth-service && PORT=8191 npx ts-node --transpile-only src/server.ts >"$LOGS/auth.log" 2>&1) & PIDS+=($!)
  (cd services/waste-service && PORT=8193 PERMIT_LIFECYCLE_SCHEDULER=off NOTIFICATION_WORKER=off CORS_ORIGINS=https://allowed.example npx ts-node --transpile-only src/server.ts >"$LOGS/waste.log" 2>&1) & PIDS+=($!)
  for _ in $(seq 1 60); do
    curl -sf http://localhost:8191/api/auth/ready >/dev/null && curl -sf http://localhost:8193/api/waste/ready >/dev/null && break
    sleep 1
  done
  curl -sf http://localhost:8191/api/auth/ready >/dev/null || { tail -30 "$LOGS/auth.log"; echo "FAILED: auth-service test instance not ready (apply migrations to the local database)"; exit 1; }
  curl -sf http://localhost:8193/api/waste/ready >/dev/null || { tail -30 "$LOGS/waste.log"; echo "FAILED: waste-service test instance not ready (apply migrations to the local database)"; exit 1; }
  run_suite() {
    local dir="$1" script="$2" out
    out="$(cd "$dir" && AUTH_BASE_URL=http://localhost:8191 WASTE_BASE_URL=http://localhost:8193 E2E_BASE_URL=http://localhost:8193 node "scripts/$script" 2>&1)" || { echo "$out" | tail -30; echo "FAILED: $script"; exit 1; }
    grep -q "Cleanup failed" <<<"$out" && { echo "$out" | grep -A5 "Cleanup failed"; echo "FAILED: $script left test data behind"; exit 1; }
    echo "   ok  $script — $(grep -Eo 'All [0-9]+ checks passed' <<<"$out")"
  }
  run_suite services/auth-service e2e-sessions.cjs
  run_suite services/waste-service e2e-permit-lifecycle.cjs
  run_suite services/waste-service e2e-recycling-oversight.cjs
  run_suite services/waste-service e2e-regulatory-portal.cjs
  run_suite services/waste-service e2e-city-report.cjs
  run_suite services/waste-service e2e-pagination.cjs
  run_suite services/waste-service e2e-recycling-factories.cjs
  run_suite services/waste-service e2e-notifications.cjs
  run_suite services/waste-service e2e-disposal-verification.cjs
  run_suite services/waste-service e2e-illegal-dumping.cjs
  run_suite services/waste-service e2e-penalties.cjs
  run_suite services/waste-service e2e-track-checks.cjs
  run_suite services/waste-service e2e-subscriptions.cjs
fi

printf '\nRelease check passed.\n'
rm -rf "$LOGS"
