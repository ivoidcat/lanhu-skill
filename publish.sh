#!/usr/bin/env bash
# publish.sh — 把本机技能（~/.agents/skills/lanhu）同步到本仓库并推送。
# 推送前扫描真实 id，命中就中止，避免把内部 projectId/teamId 公开出去。
set -euo pipefail

SRC="${HOME}/.agents/skills/lanhu"
DST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

if [ ! -d "$SRC" ]; then
  echo "✗ 找不到 $SRC" >&2
  exit 1
fi

if grep -rEn "$UUID" "$SRC" --include='*.md' --include='*.mjs' 2>/dev/null | head -1 | grep -q .; then
  echo "✗ 源目录里还有看起来像真实 id 的 UUID，先脱敏再发布：" >&2
  grep -rEn "$UUID" "$SRC" --include='*.md' --include='*.mjs' | head -10 >&2
  exit 1
fi

if grep -rn "客户-20" "$SRC" --include='*.md' 2>/dev/null | head -1 | grep -q .; then
  echo "✗ 源目录里还有客户/项目字样，先脱敏再发布：" >&2
  grep -rn "客户-20" "$SRC" --include='*.md' | head -5 >&2
  exit 1
fi

rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude 'README.md' \
  --exclude '.gitignore' \
  --exclude 'publish.sh' \
  --exclude 'install.sh' \
  "$SRC/" "$DST/"

cd "$DST"
git add -A
if git diff --cached --quiet; then
  echo "✓ 没有变化，无需推送"
  exit 0
fi

git commit -q -m "chore: sync skill from ~/.agents/skills/lanhu ($(date +%F))"
git push -q origin HEAD
echo "✓ 已推送 $(git rev-parse --short HEAD) → $(git remote get-url origin)"
