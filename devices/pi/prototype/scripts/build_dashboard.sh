#!/usr/bin/env bash
set -euo pipefail
prototype_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$prototype_root/tools/node/node-v22.16.0-linux-arm64/bin:$PATH"
cd "$prototype_root/../dashboard-new"
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
npm run lint
npm run build
