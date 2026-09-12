#!/usr/bin/env bash
# Assemble the Cloudflare (Higgsfield) app directory from the monorepo sources.
# Usage: deploy/higgsfield/sync.sh  (run from repo root after `pnpm build`)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/deploy/higgsfield/app"
rm -rf "$APP/src/shared" "$APP/src/game" "$APP/public"
mkdir -p "$APP/src/shared" "$APP/src/game" "$APP/public"
cp "$ROOT"/packages/shared/src/*.ts "$APP/src/shared/"
# Game room: same class as the Node server, import path rewritten to the vendored shared copy.
sed 's#from "@mobilwar/shared"#from "../shared/index"#' "$ROOT/apps/server/src/room.ts" > "$APP/src/game/room.ts"
# Strip ".js" extensions from vendored relative imports (bundler resolution).
sed -i 's#\(from "\./[a-zA-Z_-]*\)\.js"#\1"#' "$APP"/src/shared/*.ts
# Client: build with same-origin API and copy the static output.
( cd "$ROOT/apps/client" && VITE_API_URL= npx vite build --emptyOutDir >/dev/null )
cp -r "$ROOT/apps/client/dist/." "$APP/public/"
echo "synced -> $APP"
