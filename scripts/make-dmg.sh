#!/usr/bin/env bash
# 生成 DMG（不依赖 electron-builder 的 dmg 目标）
#
# 什么时候用：electron-builder 的 dmg 流程需要挂载临时卷到 /Volumes 并清理
# AppleDouble 文件，在受限环境（CI 沙箱、受管设备）里会被拒绝。此脚本改用
# 单步 hdiutil create -srcfolder，不挂载临时卷即可产出可用的 DMG。
#
# 用法：
#   bash scripts/make-dmg.sh                     # 使用 release/mac-arm64/DisplaySwitch.app
#   bash scripts/make-dmg.sh path/to/App.app     # 指定 app
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT/release/mac-arm64/DisplaySwitch.app}"

if [[ ! -d "$APP" ]]; then
  echo "!! 找不到 app：$APP" >&2
  echo "   先执行：npx electron-builder --mac --arm64 --dir" >&2
  exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
ARCH="$(lipo -archs "$APP/Contents/MacOS/DisplaySwitch" 2>/dev/null || echo arm64)"
VOLNAME="DisplaySwitch $VERSION"
OUT="$ROOT/release/DisplaySwitch-$VERSION-$ARCH.dmg"

# 签名校验：未签名或签名失效时补 adhoc，否则装到别的机器会被 Gatekeeper 拦
if ! codesign -v --deep --strict "$APP" >/dev/null 2>&1; then
  echo "==> 补 adhoc 签名"
  codesign --force --deep --sign - "$APP"
fi
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature" | sed 's/^/   /'

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> 暂存 app"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

echo "==> 生成 DMG: $(basename "$OUT")"
rm -f "$OUT"
hdiutil create \
  -srcfolder "$STAGE" \
  -volname "$VOLNAME" \
  -fs APFS \
  -format UDZO \
  -quiet \
  "$OUT"

echo "==> 校验"
hdiutil verify "$OUT" >/dev/null && echo "   DMG 校验通过"
ls -lh "$OUT"
echo "==> 完成: $OUT"
