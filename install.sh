#!/usr/bin/env bash
# install.sh — 把本仓库的技能安装到 ~/.agents/skills/lanhu（换机 / 同事使用）。
# 已存在时先备份为 lanhu.bak-<时间戳>。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="${HOME}/.agents/skills/lanhu"

if [ -d "$DST" ]; then
  BAK="${DST}.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$DST" "$BAK"
  echo "· 已有技能已备份到 $BAK"
fi

mkdir -p "$DST"
rsync -a \
  --exclude '.git' \
  --exclude 'README.md' \
  --exclude '.gitignore' \
  --exclude 'publish.sh' \
  --exclude 'install.sh' \
  "$SRC/" "$DST/"

echo "✓ 已安装到 $DST"
echo "  重启 ZCode 后生效"
