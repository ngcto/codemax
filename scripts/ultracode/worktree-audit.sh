#!/usr/bin/env bash
# Compatibility entrypoint; the portable audit performs no fetch or deletion.
set -eu
exec node "$(dirname "$0")/worktree-audit.mjs" "$@"
