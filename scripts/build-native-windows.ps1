# 构建 Windows x64 的 display-ddc.exe
#
# 必须在装有 Visual Studio (MSVC) + CMake 的 Windows 机器上执行。
# 在 macOS 上无法交叉编译这套 Win32 API 代码。
#
# 用法（在项目根目录的 PowerShell 中）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-native-windows.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'native\windows'
$buildDir = Join-Path $source 'build'
$output = Join-Path $root 'resources\bin\win32-x64\display-ddc.exe'

Write-Host "==> 检查工具链"
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  throw '未找到 cmake，请先安装 CMake 并加入 PATH'
}

Write-Host "==> 配置 CMake (x64)"
cmake -S $source -B $buildDir -A x64

Write-Host "==> 编译 Release"
cmake --build $buildDir --config Release

if (-not (Test-Path $output)) {
  throw "编译完成但没有找到产物: $output"
}

$item = Get-Item $output
Write-Host "==> 产物: $($item.FullName) ($([math]::Round($item.Length / 1KB, 1)) KB)"

Write-Host "==> 冒烟测试: display-ddc.exe list --json"
& $output list --json
if ($LASTEXITCODE -ne 0) {
  throw "冒烟测试失败，退出码 $LASTEXITCODE"
}

Write-Host "==> 完成"
