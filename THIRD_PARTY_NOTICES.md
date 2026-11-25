# 第三方组件声明

本项目的安装包内嵌了以下第三方可执行文件。分发本应用时，这些声明与许可证必须随包保留。

## m1ddc 1.3.1

- 上游项目：https://github.com/waydabber/m1ddc
- 作者：waydabber
- 许可证：MIT
- 用途：在 macOS Apple Silicon 上通过 DDC/CI 读写外接显示器（本项目用它设置 VCP `0x60` 输入源）
- 分发形式：随包提供 arm64 可执行文件，未修改源码
- 许可证全文：`resources/bin/darwin-arm64/LICENSE-m1ddc`

MIT 许可证允许再分发与商用，但要求在副本中保留版权声明与许可声明。
本项目的 `resources/bin/darwin-arm64/LICENSE-m1ddc` 即满足该要求，且该目录会通过
`electron-builder` 的 `extraResources` 原样进入安装包。

## Electron / React / Vite 等

这些依赖通过 npm 安装并在构建期打包，遵循各自的许可证（MIT / Apache-2.0 等），
其许可证文本由 `electron-builder` 在打包时纳入应用的 `LICENSES.chromium.html` 等文件。
