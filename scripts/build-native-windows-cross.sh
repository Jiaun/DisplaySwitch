#!/usr/bin/env bash
# 在 macOS 上用 mingw-w64 交叉编译 display-ddc.exe
#
# 用途：手边没有 Windows 机器时，也能产出一个可用的 Win32 helper。
# 局限：交叉编译通过 ≠ 实机通过。DDC 行为必须在 Windows 上真接显示器验证。
#
# 依赖：brew install mingw-w64
# 用法：bash scripts/build-native-windows-cross.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/native/windows/display-ddc.cpp"
OUT_DIR="$ROOT/resources/bin/win32-x64"
OUT="$OUT_DIR/display-ddc.exe"
CXX="${CXX:-x86_64-w64-mingw32-g++}"

if ! command -v "$CXX" >/dev/null 2>&1; then
  echo "!! 找不到 $CXX，先执行：brew install mingw-w64" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "==> 编译 $CXX"
"$CXX" \
  -std=c++17 -O2 -Wall -Wextra \
  -DUNICODE -D_UNICODE -DNOMINMAX -DWIN32_LEAN_AND_MEAN \
  -static -static-libgcc -static-libstdc++ \
  "$SRC" \
  -o "$OUT" \
  -ldxva2 -luser32

echo "==> 产物"
file "$OUT"
ls -lh "$OUT"

echo "==> 校验 PE 架构与导入表"
x86_64-w64-mingw32-objdump -p "$OUT" | grep -E "^\s+DLL Name" | sed 's/^/   /'

echo "==> 完成: $OUT"
