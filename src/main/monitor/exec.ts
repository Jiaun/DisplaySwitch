import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { DdcError, type DdcErrorCode } from './types'

export interface RunOptions {
  timeoutMs?: number
  /** 失败时使用的错误分类 */
  failureCode?: DdcErrorCode
  failureMessage?: string
}

export interface RunResult {
  stdout: string
  stderr: string
}

const DEFAULT_TIMEOUT = 8000
const MAX_BUFFER = 1024 * 1024

/**
 * 以参数数组方式执行原生 helper。
 * 永不拼接 shell 字符串：用户可控的值（如 VCP 值）作为单个 argv 传入，
 * 避免任何形式的命令注入。
 */
export function runBinary(bin: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = DEFAULT_TIMEOUT, failureCode = 'UNKNOWN', failureMessage } = options

  if (!existsSync(bin)) {
    const hint =
      process.platform === 'win32'
        ? 'Windows 版需要 display-ddc.exe：请在 Windows 上用 scripts/build-native-windows.ps1 编译后再打包。'
        : '请重新安装应用，或运行 npm run native:macos 重新生成原生组件。'
    return Promise.reject(new DdcError('BINARY_MISSING', `未找到原生组件：${bin}`, hint))
  }

  return new Promise<RunResult>((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
          return
        }

        const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: string }

        if (err.code === 'ENOENT') {
          reject(new DdcError('BINARY_MISSING', `无法执行原生组件：${bin}`, '文件缺失或没有执行权限。'))
          return
        }

        // execFile 超时后会以 SIGKILL/SIGTERM 终止子进程
        if (err.killed || err.signal === 'SIGKILL' || err.signal === 'SIGTERM') {
          reject(
            new DdcError(
              'TIMEOUT',
              `显示器没有在 ${timeoutMs / 1000} 秒内响应`,
              '可能是显示器休眠、线材不支持 DDC/CI，或该接口未启用 DDC 通信。'
            )
          )
          return
        }

        reject(
          new DdcError(
            failureCode,
            failureMessage ?? err.message ?? '原生组件执行失败',
            String(stderr ?? '').trim() || undefined
          )
        )
      }
    )
  })
}

/**
 * DDC 通道对并发访问敏感。同一显示器的读写串行执行，
 * 避免连续点击、快捷键连按时互相打断导致假失败。
 */
const chains = new Map<string, Promise<unknown>>()

export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  // 链式队列只保留完成信号，不向上抛出异常，避免污染后续任务
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}
