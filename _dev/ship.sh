#!/usr/bin/env bash
# _dev/ship.sh — semi-automated verify + commit + push.
#
# Usage:
#   _dev/ship.sh path/to/file1 [path/to/file2 ...]
#
# Runs npm run verify first and stops if it fails — nothing gets staged or
# committed on a broken state. Shows the diff for the files you named and
# waits for you to actually look at it before asking for a commit message.
# Push is a separate y/N prompt, not automatic.

set -e

if [ "$#" -eq 0 ]; then
  echo "Usage: _dev/ship.sh path/to/file1 [path/to/file2 ...]"
  exit 1
fi

echo "=== npm run verify ==="
npm run verify

echo ""
echo "=== git diff (review before committing) ==="
git --no-pager diff -- "$@"

echo ""
read -r -p "Commit message: " msg
if [ -z "$msg" ]; then
  echo "Empty commit message — aborting, nothing staged or committed."
  exit 1
fi

git add -- "$@"
git commit -m "$msg"

echo ""
read -r -p "Push to origin now? [y/N] " push
if [[ "$push" =~ ^[Yy]$ ]]; then
  git push
else
  echo "Not pushed — run 'git push' when you're ready."
fi
