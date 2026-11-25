#!/usr/bin/env bash
# 构建 / 收集 macOS arm64 的 m1ddc，并放入 resources/bin/darwin-arm64
#
# 优先直接复制 Homebrew 已安装的 m1ddc（最快，适合开发验证）；
# 没有 Homebrew 时从上游源码编译。两条路径都会带上上游 LICENSE。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/resources/bin/darwin-arm64"
mkdir -p "$DEST"

echo "==> 目标目录: $DEST"

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "!! 当前机器不是 Apple Silicon，产出的二进制无法用于 darwin-arm64 包" >&2
fi

if command -v m1ddc >/dev/null 2>&1; then
  SRC="$(command -v m1ddc)"
  echo "==> 使用已安装的 m1ddc: $SRC"
  cp -f "$SRC" "$DEST/m1ddc"

  BREW_PREFIX="$(brew --prefix m1ddc 2>/dev/null || true)"
  if [[ -n "$BREW_PREFIX" && -f "$BREW_PREFIX/LICENSE" ]]; then
    cp -f "$BREW_PREFIX/LICENSE" "$DEST/LICENSE-m1ddc"
  fi
else
  echo "==> 未找到 m1ddc，从上游源码构建"
  if ! command -v git >/dev/null 2>&1; then
    echo "!! 需要 git 才能从源码构建" >&2
    exit 1
  fi

  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  git clone --depth 1 https://github.com/waydabber/m1ddc.git "$TMP/m1ddc"
  cd "$TMP/m1ddc"

  if [[ -f Package.swift ]] && command -v swift >/dev/null 2>&1; then
    swift build -c release
    cp -f .build/release/m1ddc "$DEST/m1ddc"
  else
    make
    cp -f build/Release/m1ddc "$DEST/m1ddc" 2>/dev/null || cp -f m1ddc "$DEST/m1ddc"
  fi

  cp -f LICENSE "$DEST/LICENSE-m1ddc" 2>/dev/null || true
fi

chmod +x "$DEST/m1ddc"

# 上游二进制是 adhoc 链接签名；重新做一次 adhoc 签名，避免嵌进 App 后签名失效
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$DEST/m1ddc" >/dev/null 2>&1 || \
    echo "!! adhoc 签名失败，可能影响分发（本地开发不影响）" >&2
fi

echo "==> 校验动态库依赖（应只包含系统框架）"
otool -L "$DEST/m1ddc"

echo "==> 冒烟测试"
"$DEST/m1ddc" display list || echo "!! 列显示器失败：确认已连接外接显示器"

echo "==> 完成: $DEST/m1ddc"
