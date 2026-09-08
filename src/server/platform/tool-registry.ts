/**
 * @module platform/tool-registry
 * @description 平台原生工具注册表
 *
 * 平台原生工具（非 MCP 来源、由 adw 自身实现的工具，如需求查询）在此注册。
 * 统一注册后向两个方向投影：
 * - pi 引擎：asPiCustomTools() → createAgentSession({customTools})，模型直接调用
 * - claude 引擎：经 MCP 网关聚合暴露（见 mcp-gateway.ts），SDK 以 HTTP MCP 挂载
 *
 * MCP 上游服务器的转发工具不在此注册（由 McpGateway 管理生命周期），
 * 但投影接口形状一致，PiProvider 统一消费两者。
 */

import type {PlatformToolDefinition} from './types.js';

/**
 * 将平台工具投影为 pi 引擎的 customTools 项（ToolDefinition 形状）
 * @description pi 的 ToolDefinition.parameters（TypeBox）本质是 JSON Schema
 * 兼容对象，直接断言传入；execute 适配五参签名并归一化结果。
 * PlatformToolRegistry 与 McpGateway 的转发工具共用本投影。
 */
export function toPiCustomTool(
    tool: PlatformToolDefinition,
    source: string,
): Record<string, unknown> {
    return {
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.inputSchema,
        executionMode: 'sequential' as const,
        async execute(
            _toolCallId: string,
            args: Record<string, unknown>,
            signal?: AbortSignal,
        ): Promise<{ content: Array<{ type: 'text'; text: string }>; details: unknown; isError?: boolean }> {
            const result = await tool.execute(args ?? {}, {signal, source});
            return {
                content: [{type: 'text', text: result.text}],
                details: {category: tool.category},
                ...(result.isError ? {isError: result.isError} : {}),
            };
        },
    };
}

/**
 * 平台工具注册表
 * @description 进程内单例语义由调用方管理（getPlatformToolRegistry）。
 */
export class PlatformToolRegistry {
    private tools = new Map<string, PlatformToolDefinition>();

    /**
     * 注册平台工具（同名覆盖，便于热更新）
     * @throws 工具名非法（空/含空格）时抛出
     */
    register(tool: PlatformToolDefinition): void {
        if (!tool.name || /\s/.test(tool.name)) {
            throw new Error(`Invalid platform tool name: "${tool.name}"`);
        }
        this.tools.set(tool.name, tool);
    }

    /** 注销工具 */
    unregister(name: string): void {
        this.tools.delete(name);
    }

    /** 列出全部已注册工具（快照） */
    list(): PlatformToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /** 按名称获取 */
    get(name: string): PlatformToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * 投影为 pi 引擎的 customTools 形状
     */
    asPiCustomTools(source: string): Array<Record<string, unknown>> {
        return this.list().map((tool) => toPiCustomTool(tool, source));
    }
}

/** 平台工具注册表单例（进程内共享） */
let registryInstance: PlatformToolRegistry | null = null;

/** 获取平台工具注册表单例 */
export function getPlatformToolRegistry(): PlatformToolRegistry {
    if (!registryInstance) {
        registryInstance = new PlatformToolRegistry();
    }
    return registryInstance;
}
