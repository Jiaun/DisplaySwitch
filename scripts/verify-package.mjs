#!/usr/bin/env node
/**
 * 打包产物自检：确认安装包/应用目录里该有的东西都在。
 * 这是"安装后无需用户自行安装 Node/Homebrew/Python"这条验收项的守门人。
 *
 * 用法：node scripts/verify-package.mjs [release/<产物>]
 * 不带参数时自动在 release/ 下查找。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

function check(condition, message) {
  if (!condition) problems.push(message)
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// 1. 编译产物
const requiredBuild = ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']
for (const relative of requiredBuild) {
  const absolute = path.join(root, relative)
  check(fs.existsSync(absolute), `缺少构建产物: ${relative}（先运行 npm run build）`)
}

// 2. 原生 helper 与许可证
const macBinary = path.join(root, 'resources/bin/darwin-arm64/m1ddc')
const macLicense = path.join(root, 'resources/bin/darwin-arm64/LICENSE-m1ddc')
const winBinary = path.join(root, 'resources/bin/win32-x64/display-ddc.exe')

if (fs.existsSync(macBinary)) {
  check(isExecutable(macBinary), 'macOS m1ddc 没有执行权限')
  check(fs.existsSync(macLicense), '缺少 m1ddc 的许可证文件')
  notes.push(`macOS helper: ${fs.statSync(macBinary).size} bytes`)
} else {
  notes.push('未找到 macOS helper（仅影响 macOS 包）')
}

if (fs.existsSync(winBinary)) {
  notes.push(`Windows helper: ${fs.statSync(winBinary).size} bytes`)
} else {
  notes.push('未找到 Windows helper（仅影响 Windows 包，需在 Windows 上编译）')
}

// 3. 已产出的安装包 / 应用目录
const releaseDir = path.join(root, 'release')
if (fs.existsSync(releaseDir)) {
  const entries = fs.readdirSync(releaseDir)

  const appBundle = entries.find((name) => name.endsWith('.app'))
  if (appBundle) {
    const resourcesBin = path.join(releaseDir, appBundle, 'Contents/Resources/bin')
    const bundledBinary = path.join(resourcesBin, 'm1ddc')
    check(fs.existsSync(bundledBinary), `App 包内缺少 Resources/bin/m1ddc`)
    if (fs.existsSync(bundledBinary)) {
      check(isExecutable(bundledBinary), 'App 包内 m1ddc 没有执行权限')
      notes.push('App 包内已包含 m1ddc')
    }
  }

  const dmgs = entries.filter((name) => name.endsWith('.dmg'))
  const exes = entries.filter((name) => name.endsWith('.exe'))
  if (dmgs.length) notes.push(`DMG: ${dmgs.join(', ')}`)
  if (exes.length) notes.push(`EXE: ${exes.join(', ')}`)
  if (!dmgs.length && !exes.length && !appBundle) {
    notes.push('release/ 中没有安装包（尚未执行 build:mac / build:win）')
  }
} else {
  notes.push('release/ 目录不存在，尚未打包')
}

// 输出
console.log('--- DisplaySwitch 打包自检 ---')
for (const note of notes) console.log(`  · ${note}`)

if (problems.length === 0) {
  console.log('\n✅ 全部检查通过')
  process.exit(0)
}

console.log('\n❌ 发现问题:')
for (const problem of problems) console.log(`  - ${problem}`)
process.exit(1)
