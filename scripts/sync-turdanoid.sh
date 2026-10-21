#!/usr/bin/env bash
# Portable entry point. Imports only committed upstream files, including an exact SHA.
# Usage: scripts/sync-turdanoid.sh [--source /path/to/Turdanoid] [branch|tag|SHA]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/lib/sync-turdanoid.cjs" "$@"
