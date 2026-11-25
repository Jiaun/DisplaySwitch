cmake_minimum_required(VERSION 3.20)
project(display-ddc CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT MSVC)
  message(FATAL_ERROR "display-ddc 只支持用 MSVC 在 Windows 上构建")
endif()

add_executable(display-ddc display-ddc.cpp)

target_compile_definitions(display-ddc PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)

target_link_libraries(display-ddc PRIVATE Dxva2.lib User32.lib)

# 静态链接 CRT，避免目标机器缺少 VC++ 运行库
set_property(TARGET display-ddc PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# 产物直接放到 Electron 打包会读取的位置
set_target_properties(display-ddc PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY           "${CMAKE_SOURCE_DIR}/../../resources/bin/win32-x64"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG     "${CMAKE_SOURCE_DIR}/../../resources/bin/win32-x64"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE   "${CMAKE_SOURCE_DIR}/../../resources/bin/win32-x64"
)
