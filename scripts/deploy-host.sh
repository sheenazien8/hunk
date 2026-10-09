#!/usr/bin/env bash
# Build hunk and (re)start it as a systemd user service on the host.
# See deploy/hunk.service.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

pnpm build

# Standalone output doesn't include static assets (same as the Dockerfile).
standalone=.next/standalone
cp -r public "$standalone/"
mkdir -p "$standalone/.next"
cp -r .next/static "$standalone/.next/"

# server.js chdirs into .next/standalone and reads these at runtime; point them
# at the repo copies so edits apply without a rebuild.
for f in acp.config.json ignore.config.json plugins.json; do
  [ -e "$f" ] && ln -sfn "$root/$f" "$standalone/$f"
done

unit_dir="$HOME/.config/systemd/user"
mkdir -p "$unit_dir"
# Pre-rebrand unit; it would hold port 3456.
if [ -e "$unit_dir/git-review.service" ]; then
  systemctl --user disable --now git-review.service || true
  rm -f "$unit_dir/git-review.service"
fi
ln -sfn "$root/deploy/hunk.service" "$unit_dir/hunk.service"
systemctl --user daemon-reload
systemctl --user enable hunk.service
systemctl --user restart hunk.service
systemctl --user --no-pager status hunk.service | head -n 5
