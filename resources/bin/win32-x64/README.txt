此目录用于存放 display-ddc.exe（Windows x64 DDC/CI helper）。

生成方式（必须在 Windows 上，需要 Visual Studio + CMake）：
    powershell -ExecutionPolicy Bypass -File scripts/build-native-windows.ps1

构建产物会自动输出到本目录，并被 electron-builder 的 extraResources 打进安装包的 Resources/bin/。

如果这里没有 display-ddc.exe：
  - macOS 版不受影响，可以正常开发和打包；
  - Windows 版启动后会在「诊断」里显示"原生组件未找到"，切换功能不可用，但界面不会崩溃。
