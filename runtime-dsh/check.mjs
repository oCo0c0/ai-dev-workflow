/**
 * postinstall 自检：验证运行时依赖树完整（可解析、身份正确）。
 * 失败时打印缺失项并以非零码退出，让安装立即暴露问题而不是等到首次 spawn。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const required = [
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-sdk-jsonrpc-server',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-mcp-client',
]

const missing = []
for (const name of required) {
  try {
    require.resolve(`${name}/package.json`)
  } catch {
    missing.push(name)
  }
}

if (missing.length > 0) {
  console.error(`[adw-dsh-runtime] missing packages: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`[adw-dsh-runtime] runtime dependency tree OK (${required.length} core packages resolved)`)
