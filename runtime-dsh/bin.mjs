/**
 * adw-dsh-runtime bin：无人值守 dsh JSON-RPC 运行时启动器。
 *
 * 用法：node bin.mjs <path/to/cordis.yml>
 * stdout 专属于 JSON-RPC 协议；诊断一律写 stderr。
 * 进程生命周期归 stdin/signal：stdin EOF 或 SIGTERM/SIGINT 时 dispose 并退出。
 * （形状对齐 dsh 官方 examples/jsonrpc-demo/src/runner.ts，仅保留最小集。）
 */
import { existsSync } from 'node:fs'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'

const NAME = 'adw-dsh-runtime'

installFailLoud(NAME)

const configPath = process.argv[2]
if (configPath === undefined || configPath === '' || !existsSync(configPath)) {
  process.stderr.write(`usage: ${NAME} <path/to/cordis.yml>\n`)
  process.exit(1)
}

const ctx = await boot(NAME, configPath)

let exiting = false
async function disposeAndExit(code) {
  if (exiting) return
  exiting = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

process.stdin.on('end', () => { void disposeAndExit(0) })
process.on('SIGTERM', () => { void disposeAndExit(0) })
process.on('SIGINT', () => { void disposeAndExit(130) })
