#!/usr/bin/env bash
# Manual runtime only, after approval A. No credentials enter Docker configuration/layers.
set -euo pipefail
test -t 0 || { printf '%s\n' 'Use an interactive operator terminal.' >&2; exit 1; }
test "${1:-}" = before || { printf '%s\n' 'This entry point only supports approved read-only inspection before migration.' >&2; exit 1; }
unset DATABASE_URL WANDERMAP_TEST_DATABASE_URL NODE_OPTIONS NODE_TLS_REJECT_UNAUTHORIZED
export NODE_ENV=production PGSSLMODE=verify-full WANDERMAP_RELEASE_ROOT=/release
read -r -p 'Exact approved Render external hostname: ' WANDERMAP_PROD_HOST
export WANDERMAP_PROD_HOST
read -r -s -p 'Production External Database URL (hidden): ' DATABASE_URL
printf '\n'
export DATABASE_URL
trap 'unset DATABASE_URL WANDERMAP_PROD_HOST' EXIT
node /opt/wandermap-ops/inspect-production.cjs before
