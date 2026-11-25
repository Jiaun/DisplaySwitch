// display-ddc — Windows DDC/CI 输入源切换 helper
//
// 用法（stdout 输出 JSON，stderr 输出日志，非零退出码表示失败）：
//   display-ddc.exe list --json
//   display-ddc.exe get-input --monitor <id>
//   display-ddc.exe set-input --monitor <id> --value <decimal 0-255>
//
// 退出码：0 成功 / 1 一般错误 / 2 未找到显示器 / 3 VCP 读写失败 / 4 参数错误
//
// 说明：
//  * 使用 Win32 Monitor Configuration API（Dxva2），不安装驱动、不申请管理员权限。
//  * 必须完整走 EnumDisplayMonitors → GetPhysicalMonitorsFromHMONITOR →
//    VCP 读写 → DestroyPhysicalMonitors，任何分支都不能漏掉句柄释放。
//  * 显示器标识由「设备名 + 物理显示器序号」构成，避免只依赖索引 0。
//
// 注意：本文件在 macOS 上无法编译验证，需在 Windows 实机用 CMake 构建并测试。

#include <windows.h>
#include <lowlevelmonitorconfigurationapi.h>
#include <physicalmonitorenumerationapi.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

// MSVC 用 pragma 自动链接；MinGW 交叉编译时通过 -ldxva2 -luser32 指定
#ifdef _MSC_VER
#pragma comment(lib, "Dxva2.lib")
#pragma comment(lib, "User32.lib")
#endif

namespace {

constexpr BYTE VCP_INPUT_SOURCE = 0x60;

enum ExitCode {
  kOk = 0,
  kGeneralError = 1,
  kMonitorNotFound = 2,
  kVcpFailure = 3,
  kUsage = 4,
};

struct MonitorRecord {
  std::wstring id;
  std::wstring device;
  std::wstring description;
  int physicalIndex = 0;
  bool ddcAvailable = false;
  bool hasInput = false;
  DWORD input = 0;
};

std::string ToUtf8(const std::wstring& text) {
  if (text.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()),
                                       nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), out.data(), size,
                      nullptr, nullptr);
  return out;
}

std::string JsonEscape(const std::string& text) {
  std::string out;
  out.reserve(text.size() + 8);
  for (unsigned char ch : text) {
    switch (ch) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (ch < 0x20) {
          char buffer[8];
          std::snprintf(buffer, sizeof(buffer), "\\u%04x", ch);
          out += buffer;
        } else {
          out += static_cast<char>(ch);
        }
    }
  }
  return out;
}

void LogError(const std::wstring& message) {
  std::fprintf(stderr, "[display-ddc] %s\n", ToUtf8(message).c_str());
}

bool ReadInput(HANDLE monitor, DWORD* value) {
  MC_VCP_CODE_TYPE codeType = MC_MOMENTARY;
  DWORD current = 0;
  DWORD maximum = 0;
  if (!GetVCPFeatureAndVCPFeatureReply(monitor, VCP_INPUT_SOURCE, &codeType, &current, &maximum)) {
    return false;
  }
  *value = current;
  return true;
}

// 枚举所有物理显示器。回调内必须成对调用 Get/DestroyPhysicalMonitors。
struct EnumState {
  std::vector<MonitorRecord>* records = nullptr;
};

BOOL CALLBACK EnumProc(HMONITOR hMonitor, HDC /*hdc*/, LPRECT /*rect*/, LPARAM userData) {
  auto* state = reinterpret_cast<EnumState*>(userData);
  DWORD count = 0;
  if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, &count) || count == 0) {
    return TRUE;
  }

  std::vector<PHYSICAL_MONITOR> physical(count);
  if (!GetPhysicalMonitorsFromHMONITOR(hMonitor, count, physical.data())) {
    return TRUE;
  }

  MONITORINFOEXW info{};
  info.cbSize = sizeof(MONITORINFOEXW);
  GetMonitorInfoW(hMonitor, &info);

  for (DWORD index = 0; index < count; ++index) {
    MonitorRecord record;
    record.device = info.szDevice;
    record.description = physical[index].szPhysicalMonitorDescription;
    record.physicalIndex = static_cast<int>(index);
    record.id = record.device + L"#" + std::to_wstring(index);
    record.ddcAvailable = physical[index].hPhysicalMonitor != nullptr;

    DWORD value = 0;
    if (record.ddcAvailable && ReadInput(physical[index].hPhysicalMonitor, &value) && value != 0) {
      record.hasInput = true;
      record.input = value;
    }

    state->records->push_back(record);
  }

  DestroyPhysicalMonitors(count, physical.data());
  return TRUE;
}

std::vector<MonitorRecord> EnumerateMonitors() {
  std::vector<MonitorRecord> records;
  EnumState state{&records};
  EnumDisplayMonitors(nullptr, nullptr, EnumProc, reinterpret_cast<LPARAM>(&state));
  return records;
}

// 取得指定显示器句柄，并把该组内其他句柄释放掉。
// 调用方负责对自己的句柄调用 DestroyPhysicalMonitors(1, ...)。
bool AcquirePhysicalMonitor(const std::wstring& targetId, HANDLE* handleOut, MonitorRecord* recordOut) {
  struct Local {
    const std::wstring* target = nullptr;
    HANDLE handle = nullptr;
    MonitorRecord record;
    bool found = false;
  } local;

  local.target = &targetId;

  EnumDisplayMonitors(nullptr, nullptr,
                      [](HMONITOR hMonitor, HDC, LPRECT, LPARAM userData) -> BOOL {
                        auto* ctx = reinterpret_cast<Local*>(userData);
                        DWORD count = 0;
                        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, &count) || count == 0) {
                          return TRUE;
                        }
                        std::vector<PHYSICAL_MONITOR> physical(count);
                        if (!GetPhysicalMonitorsFromHMONITOR(hMonitor, count, physical.data())) {
                          return TRUE;
                        }

                        MONITORINFOEXW info{};
                        info.cbSize = sizeof(MONITORINFOEXW);
                        GetMonitorInfoW(hMonitor, &info);

                        for (DWORD index = 0; index < count; ++index) {
                          std::wstring id =
                              std::wstring(info.szDevice) + L"#" + std::to_wstring(index);
                          if (id == *ctx->target) {
                            ctx->handle = physical[index].hPhysicalMonitor;
                            ctx->record.id = id;
                            ctx->record.device = info.szDevice;
                            ctx->record.description = physical[index].szPhysicalMonitorDescription;
                            ctx->record.physicalIndex = static_cast<int>(index);
                            ctx->record.ddcAvailable = true;
                            ctx->found = true;
                          }
                        }

                        for (DWORD index = 0; index < count; ++index) {
                          const bool isTarget =
                              ctx->found && physical[index].hPhysicalMonitor == ctx->handle;
                          if (!isTarget) {
                            DestroyPhysicalMonitors(1, &physical[index]);
                          }
                        }

                        return ctx->found ? FALSE : TRUE;  // 找到后停止枚举
                      },
                      reinterpret_cast<LPARAM>(&local));

  if (!local.found) return false;

  *handleOut = local.handle;
  if (recordOut) *recordOut = local.record;
  return true;
}

void PrintUsage() {
  std::fprintf(stderr,
               "usage:\n"
               "  display-ddc list --json\n"
               "  display-ddc get-input --monitor <id>\n"
               "  display-ddc set-input --monitor <id> --value <0-255>\n");
}

int CmdList() {
  const std::vector<MonitorRecord> records = EnumerateMonitors();

  std::string json = "[";
  for (size_t i = 0; i < records.size(); ++i) {
    const MonitorRecord& record = records[i];
    if (i > 0) json += ",";
    json += "{";
    json += "\"id\":\"" + JsonEscape(ToUtf8(record.id)) + "\",";
    json += "\"name\":\"" + JsonEscape(ToUtf8(record.description)) + "\",";
    json += "\"device\":\"" + JsonEscape(ToUtf8(record.device)) + "\",";
    json += "\"ddcAvailable\":" + std::string(record.ddcAvailable ? "true" : "false");
    if (record.hasInput) {
      json += ",\"currentInput\":" + std::to_string(record.input);
    }
    json += "}";
  }
  json += "]";

  std::printf("%s\n", json.c_str());
  return kOk;
}

int CmdGetInput(const std::wstring& id) {
  HANDLE handle = nullptr;
  if (!AcquirePhysicalMonitor(id, &handle, nullptr)) {
    LogError(L"未找到显示器：" + id);
    std::printf("{\"error\":\"monitor-not-found\"}\n");
    return kMonitorNotFound;
  }

  DWORD value = 0;
  const bool ok = ReadInput(handle, &value);

  PHYSICAL_MONITOR physical{};
  physical.hPhysicalMonitor = handle;
  DestroyPhysicalMonitors(1, &physical);

  if (!ok) {
    LogError(L"读取 VCP 0x60 失败（显示器可能不支持回读）");
    std::printf("{\"error\":\"read-failed\"}\n");
    return kVcpFailure;
  }

  std::printf("{\"value\":%lu}\n", static_cast<unsigned long>(value));
  return kOk;
}

int CmdSetInput(const std::wstring& id, DWORD value) {
  if (value > 255) {
    LogError(L"VCP 值必须在 0-255 之间");
    PrintUsage();
    return kUsage;
  }

  HANDLE handle = nullptr;
  if (!AcquirePhysicalMonitor(id, &handle, nullptr)) {
    LogError(L"未找到显示器：" + id);
    std::printf("{\"error\":\"monitor-not-found\"}\n");
    return kMonitorNotFound;
  }

  PHYSICAL_MONITOR physical{};
  physical.hPhysicalMonitor = handle;

  const BOOL ok = SetVCPFeature(handle, VCP_INPUT_SOURCE, value);
  DestroyPhysicalMonitors(1, &physical);

  if (!ok) {
    LogError(L"写入 VCP 0x60 失败（显示器可能不支持该输入源）");
    std::printf("{\"error\":\"write-failed\"}\n");
    return kVcpFailure;
  }

  std::printf("{\"ok\":true,\"monitor\":\"%s\",\"value\":%lu}\n", JsonEscape(ToUtf8(id)).c_str(),
              static_cast<unsigned long>(value));
  return kOk;
}

std::wstring WidenArg(const char* arg) {
  const int size = MultiByteToWideChar(CP_UTF8, 0, arg, -1, nullptr, 0);
  if (size <= 0) return L"";
  std::wstring out(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, arg, -1, out.data(), size);
  out.resize(static_cast<size_t>(size - 1));
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    PrintUsage();
    return kUsage;
  }

  const std::string command = argv[1];

  if (command == "list") {
    return CmdList();
  }

  std::wstring monitorId;
  long value = -1;

  for (int i = 2; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--monitor" && i + 1 < argc) {
      monitorId = WidenArg(argv[++i]);
    } else if (arg == "--value" && i + 1 < argc) {
      value = std::strtol(argv[++i], nullptr, 10);
    } else if (arg == "--json") {
      continue;
    }
  }

  if (command == "get-input") {
    if (monitorId.empty()) {
      PrintUsage();
      return kUsage;
    }
    return CmdGetInput(monitorId);
  }

  if (command == "set-input") {
    if (monitorId.empty() || value < 0) {
      PrintUsage();
      return kUsage;
    }
    return CmdSetInput(monitorId, static_cast<DWORD>(value));
  }

  LogError(L"未知命令");
  PrintUsage();
  return kUsage;
}
