/**
 * adw 专属 SDK JSON-RPC 服务器插件（resume 感知版）。
 *
 * 与官方 @deepseek-ai/dsh-sdk-jsonrpc-server 的唯一行为差异：
 * 官方 createSession 只会 agents.create——当 adw 服务进程重启后以同一
 * sessionId 续接对话时，磁盘上已存在该 id 的持久化日志（append-only
 * JSONL），create 因「live 种子不覆盖已存事件前缀」抛出 id collision。
 * 本插件在此场景降级为 agents.resume：从日志恢复完整对话历史后续跑
 * （即官方报错文案 "load/resume it instead of creating" 的路径）。
 *
 * 协议、生命周期、apply 装配与官方包保持一致；官方未留子类注入点，
 * 故装配代码在此复写。stdout 专属 JSON-RPC，诊断一律写 stderr。
 */
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server'

// cordis 插件契约：name/inject/apply 由 yml loader 动态消费（IDE 标灰是误报）
export const name = 'adw-sdk-jsonrpc-server'
export const inject = ['agents']

/** 持久化冲突的报错文案特征（dsh-session-persistence 的两种 id collision） */
const PERSISTED_COLLISION = /id collision|persisted log on disk/

class ResumeAwareSdkServer extends HarnessSdkJsonRpcServer {
  async createSession(sessionId) {
    try {
      return await super.createSession(sessionId)
    } catch (err) {
      if (!PERSISTED_COLLISION.test(String(err?.message ?? ''))) throw err
      process.stderr.write(`[adw-sdk-server] session ${sessionId} persisted on disk; resuming\n`)
      // agentOptions 形状与官方 createSession 相同（provider/model/maxTokens
      // 来自 initialize 握手）；cwd 沿用持久化会话头
      const handle = await this.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        agentOptions: {
          provider: this.provider,
          model: this.model,
          ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
        },
      })
      const rec = { handle }
      this.sessions.set(sessionId, rec)
      return rec
    }
  }
}

export function apply(ctx, config = {}) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
  const server = new ResumeAwareSdkServer(ctx, transport, {
    maxTokensAsSuccess: config.maxTokensAsSuccess ?? false,
  })
  let exitTask
  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => ctx.root.fiber.dispose())])
      process.exit(0)
    })()
    return exitTask
  }
  transport.onRequest(async (method, params) => {
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') setImmediate(disposeAndExit)
    return result
  })
  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}
