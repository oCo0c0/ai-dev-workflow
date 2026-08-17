/**
 * mock dsh 运行时：按行读 JSON-RPC，应答三个请求方法并按需推送通知。
 * 用法：node dsh-mock-runtime.mjs [--exit-immediately] [--fail-next]
 * 协议对齐 dsh SDK（serverInfo.name 恒为 'deepseek-harness-sdk-runtime'）。
 */
import {createInterface} from 'node:readline'

const argv = process.argv.slice(2)

if (argv.includes('--exit-immediately')) process.exit(1)

const rl = createInterface({input: process.stdin})
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

let failNext = argv.includes('--fail-next')

rl.on('line', (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return // 非法行忽略
  }
  if (frame.id === undefined || typeof frame.method !== 'string') return

  if (failNext) {
    failNext = false
    send({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: 'mock failure' } })
    return
  }

  switch (frame.method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id: frame.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1-mock' } } })
      break
    case 'session/prompt': {
      send({ jsonrpc: '2.0', id: frame.id, result: { messageId: 'msg-' + frame.id } })
      // 推送一轮 activity：running -> assistant message -> idle
      send({ jsonrpc: '2.0', method: 'session.status', params: { sessionId: frame.params.sessionId, status: 'running' } })
      send({
        jsonrpc: '2.0', method: 'session.event',
        params: { sessionId: frame.params.sessionId, event: { type: 'assistant/message', seq: 1, time: Date.now(), data: { message: { role: 'assistant', content: [{ type: 'text', text: 'mock reply' }] } } } },
      })
      send({ jsonrpc: '2.0', method: 'session.status', params: { sessionId: frame.params.sessionId, status: 'idle' } })
      break
    }
    case 'shutdown':
      send({ jsonrpc: '2.0', id: frame.id, result: {} })
      setTimeout(() => process.exit(0), 10)
      break
    default:
      send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'method not found: ' + frame.method } })
  }
})

rl.on('close', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
