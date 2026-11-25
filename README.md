# DisplaySwitch

通过 **DDC/CI** 一键切换外接显示器输入源的桌面工具。让一台显示器连接两台电脑时，可以从菜单栏、托盘或全局快捷键发送 HDMI / DisplayPort / USB-C 输入源切换指令，减少反复操作显示器 OSD 按键。

基于 **Electron、React、TypeScript、electron-vite**；本地离线运行，无服务器、账号或云端依赖。代码按 [MIT 许可证](./LICENSE) 开源。

## 它能做什么

- 扫描外接显示器，显示设备名称、当前输入源与 DDC 状态。
- 为选中的显示器配置“这台电脑”和“另一台电脑”的输入端口，支持自定义 VCP 值。
- 通过主窗口、菜单栏 / 系统托盘、全局快捷键切换输入源。
- 保存设备选择、接口映射、快捷键、开机启动与关闭到托盘等设置。
- 在 macOS 上可选择在切换前将窗口移到另一块屏幕；这项功能需要辅助功能权限。
- 提供配置自检、错误分类、日志与诊断导出，以及不接硬件也能使用的模拟模式。

**它不是网络 KVM**：不会转发键盘鼠标、视频或文件；切换只控制选中显示器的输入源。两台主机需要分别以视频线连接显示器，并在各自系统配置相应端口。

## 平台与硬件要求

| 平台 | 当前支持范围 | 验证边界 |
| --- | --- | --- |
| macOS | Apple Silicon arm64，使用 m1ddc | 已有 M1 Pro 外接显示器枚举与 VCP 读写记录；实际切屏取决于设备 |
| Windows | Windows 10/11 x64，自研 Win32 helper | helper 与安装包构建流程已实现；真实显示器的 DDC 行为尚未实机验证 |
| Intel Mac / Linux | 暂未提供适配 | 不作为当前发布目标 |

显示器必须支持并开启 **DDC/CI**，视频线、扩展坞与转接器也需要透传 DDC。不是所有显示器都支持读取当前输入源或标准 VCP 端口值。软件返回“指令已发送”不等同于硬件已经完成切换。

## 快速开始

建议使用 Node.js 22 LTS 或更新的 LTS 版本，以及 npm。Electron 安装过程需要下载运行时。

```bash
git clone https://github.com/Jiaun/DisplaySwitch.git
cd DisplaySwitch
npm ci
npm run dev
```

无需外接显示器的 UI 开发：

```bash
npm run dev:mock
```

模拟模式提供两台虚拟显示器，不发送真实硬件切换命令。`package.json` 中 `private: true` 用于防止误发布 npm，不影响源码开源。

### macOS helper

仓库保留 MIT 许可的 arm64 `m1ddc` 与许可证，也可自行重新收集：

```bash
npm run native:macos
```

脚本优先复制本机已安装的 m1ddc，否则从官方上游构建。开发模式会查找项目资源或 Homebrew；打包后的应用只使用包内 `Resources/bin/m1ddc`，不依赖用户安装 Homebrew。

### Windows helper

推荐在 Windows 上安装 Visual Studio C++ Build Tools 与 CMake 后执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-native-windows.ps1
```

也支持在 macOS 上使用 `mingw-w64` 交叉编译：

```bash
brew install mingw-w64
bash scripts/build-native-windows-cross.sh
```

输出 `resources/bin/win32-x64/display-ddc.exe`。**编译通过不代表 Windows 真机 DDC 已验证**，请在连接显示器的 Windows 环境检查枚举、读取和切换。

## 使用流程

1. 在显示器 OSD 中启用 DDC/CI，确保两台电脑均已接好视频线。
2. 启动应用并选择一台外接显示器。
3. 设置“这台电脑”实际连接的端口与“另一台电脑”的目标端口。
4. 使用“测试配置”检查配置；首次操作时保留显示器 OSD 的手动切回方式。
5. 使用切换按钮、托盘或快捷键发送指令。

目标端口留空表示单设备显示器，不启用切换。DDC 本身无法可靠探测另一接口是否接有视频线，因此不会把“无法回读”误认为“只有一台电脑”。一次只操作一台显示器，不提供多屏批量盲切。

### macOS 窗口搬移

启用后，切换前通过 System Events 将即将失去画面的显示器上的窗口移到另一块屏幕。需要用户在系统设置中授予辅助功能权限。全屏窗口、部分自绘窗口或受限应用可能无法移动；窗口不会自动搬回，搬移失败不会阻断输入源切换。

## 构建与打包

```bash
npm run typecheck
npm run build
# macOS arm64
npm run gen:assets
npm run build:mac
# macOS 本地 DMG 备用流程
npm run build:mac:local
# Windows x64（先准备对应 helper）
npm run build:win
# 检查已有打包产物
npm run verify:package
```

`npm run build` 输出到 `out/`，桌面安装包输出到 `release/`。源码仓库不附带整套 Electron 运行时、DMG 或应用安装包。正式面向用户分发时，应自行配置 macOS Developer ID 签名 / 公证和 Windows 代码签名；本地 adhoc / 未签名包不等于已通过系统可信分发认证。

## 架构与目录

```text
src/main/index.ts         Electron 生命周期与窗口装配
src/main/services.ts      扫描、切换和配置自检
src/main/ipc.ts           IPC 白名单、输入和可信来源校验
src/main/monitor/         平台适配、子进程执行、错误分类与模拟模式
src/main/config/store.ts  本地配置持久化
src/main/shortcuts.ts     全局快捷键与注册失败处理
src/main/tray.ts          菜单栏 / 托盘菜单
src/main/window-mover.ts  macOS 窗口搬移
src/main/logging.ts       本地日志与诊断导出
src/preload/              受控的主进程 API 桥接
src/shared/               主进程与界面共享类型
src/renderer/src/         React 界面、输入源和快捷键设置
native/windows/          Win32 DDC helper 源码与 CMake 配置
native/macos/            m1ddc 来源与集成说明
resources/bin/           按平台分离的 helper 与许可证
scripts/                 helper 编译、图标生成和打包验证
```

请求链路：React 界面 → preload 白名单 → IPC / 服务层 → 平台 Adapter → 原生 helper → 显示器。macOS 通过 m1ddc，Windows 通过系统物理显示器 API 读写 MCCS VCP `0x60`。

所有 DDC 操作使用串行队列，避免并发读写冲突。macOS 在操作前重新枚举设备，将稳定标识映射到当次序号，避免插拔后误操作其他屏幕；读不到当前输入源与写入失败分别处理，写入不会盲目重试。

## 数据与安全边界

- 配置与日志存放于 Electron 用户数据目录，不上传云端。macOS 通常位于 `~/Library/Application Support/`，Windows 位于 `%APPDATA%`。
- 渲染进程关闭 Node 集成、开启上下文隔离，只能调用 preload 明确暴露的 API。
- 主进程检查 IPC 来源及输入范围；原生 helper 通过 `execFile` 参数数组调用，不拼接用户 shell 命令。
- 外部链接交给系统浏览器，应用窗口不加载任意远程页面。
- 导出诊断日志前，建议自行检查其中的设备名称与本机路径。

## 常见问题

| 问题 | 排查方式 |
| --- | --- |
| 扫描不到外接显示器 | 确认开启 DDC/CI；尝试直连，检查线材和扩展坞是否透传 |
| 无法读取输入源 | 设备可能不支持回读；核对实际接口后手动配置，不把返回 0 当成真实端口 |
| 指令成功但没画面变化 | 检查目标主机、视频线与端口值；部分显示器使用非标准 VCP 输入值 |
| 切走后无法切回 | 设备可能不再接受原主机的 DDC 指令，需要另一台电脑发指令或通过 OSD 切回 |
| 快捷键注册失败 | 与其他程序冲突时换一个组合，应用会提示失败状态 |
| macOS 窗口没搬移 | 检查辅助功能权限；全屏、沙箱或自绘窗口可能不响应 |
| 打包后找不到 helper | 检查平台专属 `extraResources` 及包内 `Resources/bin/`，运行打包验证 |

## 第三方许可与贡献

项目自有代码采用 MIT。macOS 使用的 [m1ddc](https://github.com/waydabber/m1ddc) 保留其上游 MIT 许可证；分发时必须同时保留 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 和 `LICENSE-m1ddc`。Electron、React 及构建依赖分别遵循各自许可证。

欢迎提交 Issue 或 PR。硬件问题请附系统、显示器型号、连接方式与去除个人信息后的诊断日志。提交前运行类型检查和构建；涉及输入源切换的改动请明确平台及实机验证范围，不要把模拟模式结果描述成真实硬件验证。
