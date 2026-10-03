#!/usr/bin/env bash
# Daily Open States refresh within the free key's 250 requests/day.
# Runs the ingest in a dedicated worktree on branch data/openstates-daily,
# commits any new/updated state vote snapshots, pushes, and keeps one PR open.
# Installed as a systemd user timer (see scripts/routines/README.md).
set -euo pipefail
REPO="${REPO:-$HOME/thefullrecord}"
WT="${WT:-$HOME/thefullrecord-data}"
BRANCH=data/openstates-daily
BUDGET="${BUDGET:-200}"   # leave ~50/day for spot checks

cd "$REPO"
git fetch -q origin
# Until the U.S.-wide PR is merged, the ingest only exists on its branch.
if git cat-file -e origin/main:scripts/ingest/openstates.mjs 2>/dev/null; then BASE=main; else BASE=claude/us-wide-lookup; fi

if [ ! -d "$WT" ]; then
  if git ls-remote --exit-code -q origin "$BRANCH" >/dev/null; then
    git worktree add -q "$WT" -B "$BRANCH" "origin/$BRANCH"
  else
    git worktree add -q "$WT" -b "$BRANCH" "origin/$BASE"
  fi
fi
cd "$WT"
ln -sf "$REPO/.env.local" .env.local
git merge -q --no-edit "origin/$BASE"

node --experimental-strip-types scripts/ingest/openstates.mjs --daily --budget "$BUDGET" 2>&1 | grep -v -i warning || true
node --experimental-strip-types scripts/ingest/validate.mjs >/dev/null

git add -A src/server/snapshot/ scripts/ingest/openstates-progress.json 2>/dev/null || git add -A src/server/snapshot/
if git diff --cached --quiet; then echo "No new Open States data today."; exit 0; fi
git commit -q -m "Open States daily refresh $(date -u +%F)"
git push -q -u origin "$BRANCH"
if [ -z "$(gh pr list --head "$BRANCH" --state open --json number -q '.[].number')" ]; then
  gh pr create --base "$BASE" --head "$BRANCH" \
    --title "State legislative votes: daily Open States refresh" \
    --body "Automated daily refresh of state legislative floor votes from Open States, within the free key's 250 requests/day. Each day adds never-ingested states first, then refreshes the stalest ones. Progress: \`scripts/ingest/openstates-progress.json\`. Merge whenever; the routine keeps adding commits.

🤖 Generated with [Claude Code](https://claude.com/claude-code)" >/dev/null
fi
echo "Pushed $(git log -1 --format=%h) to $BRANCH."
