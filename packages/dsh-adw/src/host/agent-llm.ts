/**
 * AgentLlm 宿主适配器：把 adw-requirement-core 的 agent 端口接到 DSH 的
 * ctx.llm（LlmRuntime）——官方插件 LLM 服务，provider 中立流式协议。
 *
 * 与 adw 本体（引擎子进程挂 MCP 工具）同一架构：core 里的 AgentFetchService
 * 驱动「任务 → 工具调用 → 工具结果回喂 → 最终 JSON」循环；本文件只负责
 * 每一轮的模型调用与消息历史维护（dsh-llm Message 不可变构造）。
 */

import {
  BlockAssembler,
  createUserMessage,
  createToolResultMessage,
  type CallId,
  type ContentBlock,
  type GenerateOptions,
  type LlmRuntime,
  type Message,
  type ReasoningEffortId,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type {
  AgentChat,
  AgentContentBlock,
  AgentLlm,
  AgentToolDef,
  AgentTurnResult,
} from '@along/adw-requirement-core'

/** 模型选择结果（provider 路由 + 模型 id + 可选推理档位） */
export interface AgentModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 模型解析（每次会话惰性解析：设置项 > 宿主默认 > 首个注册 provider） */
export type ResolveAgentModel = () => Promise<AgentModelSelection | undefined>

/** dsh-llm 流式调用面（LlmRuntime 的结构子集，便于测试替身） */
export interface LlmStreamFace {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** 一段多轮会话：维护 dsh-llm 不可变消息历史 */
class DshAgentChat implements AgentChat {
  private readonly messages: Message[] = []

  constructor(
    private readonly llm: LlmStreamFace,
    private readonly resolveModel: ResolveAgentModel,
    private readonly system: string,
    private readonly tools: AgentToolDef[],
  ) {}

  async send(content: AgentContentBlock[]): Promise<AgentTurnResult> {
    // 入站块 → 消息：文本合并为一条 user 消息；tool-result 逐条独立消息
    const texts = content.filter((b): b is Extract<AgentContentBlock, {type: 'text'}> => b.type === 'text')
    if (texts.length > 0) {
      this.messages.push(createUserMessage({
        content: texts.map(t => ({type: 'text', text: t.text})) as ContentBlock[],
        source: {kind: 'user'},
      }))
    }
    for (const block of content) {
      if (block.type !== 'tool-result') continue
      this.messages.push(createToolResultMessage({
        callId: block.toolCallId as CallId,
        content: block.content as ContentBlock[],
        isError: block.isError ?? false,
      }))
    }

    const selection = await this.resolveModel()
    if (!selection) {
      return {blocks: [], stopKind: 'error', error: '无可用模型（插件设置或宿主 llm 服务均未提供）'}
    }

    const options: GenerateOptions = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined && selection.reasoningEffort !== ''
        ? {reasoningEffort: selection.reasoningEffort as ReasoningEffortId}
        : {}),
      messages: this.messages,
      system: this.system,
      tools: this.tools,
    }

    const assembler = new BlockAssembler()
    try {
      for await (const chunk of this.llm.stream(options)) assembler.push(chunk)
    } catch (error) {
      return {blocks: [], stopKind: 'error', error: error instanceof Error ? error.message : String(error)}
    }

    const blocks = assembler.blocks()
    this.messages.push(assembler.message({
      kind: 'model', provider: selection.provider, model: selection.model,
    }))

    const finish = assembler.finish
    if (finish.kind === 'error') {
      return {blocks: [], stopKind: 'error', error: finish.failure.message}
    }
    if (finish.kind === 'aborted') {
      return {blocks: [], stopKind: 'aborted', error: '模型调用被中止'}
    }
    return {blocks: blocks.map(toAgentBlock).filter(isDefined), stopKind: finish.kind}
  }
}

/** dsh-llm 块 → agent 端口块（reasoning 丢弃；其余原样） */
function toAgentBlock(block: ContentBlock): AgentContentBlock | undefined {
  if (block.type === 'text') return {type: 'text', text: block.text}
  if (block.type === 'tool-call') {
    return {type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments}
  }
  return undefined
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

/** AgentLlm 适配器（engine 惰性取用） */
export class DshAgentLlm implements AgentLlm {
  constructor(
    private readonly getLlm: () => LlmStreamFace | undefined,
    private readonly resolveModel: ResolveAgentModel,
  ) {}

  createChat(opts: {system: string; tools: AgentToolDef[]}): AgentChat {
    const llm = this.getLlm()
    if (!llm) throw new Error('宿主 llm 服务不可用')
    return new DshAgentChat(llm, this.resolveModel, opts.system, opts.tools)
  }
}

/**
 * 模型解析工厂：插件设置（agentProvider/agentModel）> 宿主默认模型服务
 * （ctx.agentDefaultModel.currentSelection()，由调用方注入）> 首个注册
 * provider 的首个模型。
 */
export function makeModelResolver(deps: {
  /** 插件设置的显式选择（agentProvider + agentModel 齐备才生效） */
  getExplicit: () => AgentModelSelection | undefined
  /** 宿主默认模型服务的当前选择（服务未挂载时返回 undefined） */
  getDefault: () => AgentModelSelection | undefined
  llm: () => LlmRuntime | undefined
}): ResolveAgentModel {
  return async () => {
    const explicit = deps.getExplicit()
    if (explicit?.provider && explicit.model) return explicit
    const llm = deps.llm()
    if (!llm) return undefined
    const fallback = deps.getDefault()
    if (fallback?.provider && fallback.model) return fallback
    const providers = llm.listProviders()
    if (providers.length === 0) return undefined
    try {
      const models = await llm.listModels(providers[0].id)
      if (models.length > 0) return {provider: providers[0].id, model: models[0].id}
    } catch { /* 列模型失败：落到无模型错误 */ }
    return undefined
  }
}
