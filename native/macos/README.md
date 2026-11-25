# macOS 原生组件

本项目在 macOS 上复用 [m1ddc](https://github.com/waydabber/m1ddc) 作为 DDC/CI 通道，
不修改其源码。最终产物由 `scripts/build-native-macos.sh` 收集到
`resources/bin/darwin-arm64/m1ddc`，并随 `extraResources` 进入安装包。

## 为什么保留这个目录

- 记录"上游来源 + 版本 + 许可证"，避免日后无从追溯。
- 如果将来需要打补丁（例如多屏寻址、输入源 alt 寻址），源码与补丁应放在本目录，
  并明确标注改动点与上游版本号。

## 当前版本

- 版本：1.3.1
- 许可证：MIT（见 `resources/bin/darwin-arm64/LICENSE-m1ddc`）
- 二进制仅依赖系统框架（CoreDisplay / CoreFoundation / CoreGraphics / IOKit / Foundation），
  可用 `otool -L resources/bin/darwin-arm64/m1ddc` 复核。

## 已发现的限制

`m1ddc` 1.3.1 的 UUID 直接寻址不可靠：

```bash
m1ddc display CF41F720-BA4C-4B1E-A0E9-765B8CA5B087 get input   # 返回 0（无回包）
m1ddc display 1 get input                                       # 返回 15（正确）
```

因此 `src/main/monitor/macos.ts` 不使用 UUID 作为命令参数，而是每次操作前先
`m1ddc display list`，用 UUID 换算出当次序号后再执行。这样即使显示器重插、
系统重启导致序号变化，也不会控制到错误的显示器。

## 重新收集二进制

```bash
npm run native:macos
```

脚本优先复制 Homebrew 已安装的 `m1ddc`，否则从上游源码构建；随后做 adhoc 重签名
并打印动态库依赖用于核对。
