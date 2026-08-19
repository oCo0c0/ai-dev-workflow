/**
 * @file 需求引擎（Facade）
 * @description 组合 MCP 配置、桥接与本地存储，对 dsh-adw 宿主半暴露
 *   「拉取 / 搜索 / 列表 / 刷新 / 执行链接」一体的高层 API。
 *   路由与 agent 工具都只依赖本引擎，不感知适配器与 MCP 细节。
 */
import { type RequirementSourceEntry } from './mcp-bridge.js';
import type { Requirement, RequirementDetail } from './requirement-sources/types.js';
import { type ExecutionLink, type SavedRequirement } from './store.js';
/** 拉取选项 */
export interface FetchOptions {
    /** 目标 MCP server（缺省自动解析） */
    serverName?: string;
}
/** 引擎构造选项 */
export interface EngineOptions {
    /** 数据目录（需求存储与自管 MCP 配置所在，如 ~/.dsh/dsh-adw） */
    dataDir: string;
    /** 默认 MCP server 名（缺省 'ones-api'） */
    defaultServerName?: string;
    /** 本地图片 URL 前缀（默认 /api/dsh-adw/requirements，宿主路由据此服务图片） */
    imageUrlBasePrefix?: string;
}
/**
 * 需求引擎
 * @description 生命周期：构造即就绪；dispose 断开全部 MCP 连接。
 */
export declare class RequirementEngine {
    private readonly mcpConfig;
    private readonly bridge;
    private readonly store;
    private readonly defaultServerName?;
    private readonly imageUrlBasePrefix;
    constructor(opts: EngineOptions);
    /** 源目录（适配器视角：元数据 + 已配置 servers + 一键安装模板） */
    listSources(): RequirementSourceEntry[];
    /** 按适配器模板一键安装源（创建 MCP server + 连接测试） */
    installSource(adapterId: string, env: Record<string, string>): Promise<{
        serverName: string;
        connectionTest?: {
            ok: boolean;
            message: string;
        };
    }>;
    /** 连接测试 */
    testServer(serverName: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** 删除一个 MCP server 配置（源卸载；返回是否存在） */
    removeServer(serverName: string): boolean;
    /**
     * 拉取需求并保存（推荐入口）
     * @param input - 用户原始输入（链接 / 编号 / issue key / owner-repo#N）
     * @returns 保存后的完整需求（含溯源 + 既有执行历史）
     */
    fetchAndSave(input: string, opts?: FetchOptions): Promise<SavedRequirement>;
    /** 本地图片文件路径（宿主静态路由用；不存在/不安全返回 undefined） */
    getImagePath(id: string, filename: string): string | undefined;
    /** 源内搜索（不落库） */
    search(query: string, opts?: FetchOptions): Promise<Requirement[]>;
    /** 已保存需求列表（最近拉取在前） */
    list(): SavedRequirement[];
    /** 已保存需求详情 */
    get(id: string): SavedRequirement | undefined;
    /** 删除 */
    delete(id: string): boolean;
    /** 按原始输入重拉并覆盖（保留执行历史） */
    refresh(id: string): Promise<SavedRequirement | undefined>;
    /** 记录一条执行链接（生成 executionId） */
    addExecution(id: string, link: Omit<ExecutionLink, 'executionId' | 'startedAt'> & {
        startedAt?: string;
    }): {
        executionId: string;
        requirement: SavedRequirement;
    } | undefined;
    /** 回写执行结局 */
    settleExecution(id: string, executionId: string, outcome: ExecutionLink['outcome'], error?: string): SavedRequirement | undefined;
    /** 断开全部 MCP 连接（插件卸载时调用） */
    dispose(): Promise<void>;
}
/** 渲染开发 prompt（占位符替换，纯函数；模板来自插件设置） */
export declare function renderDevPrompt(template: string, req: RequirementDetail): string;
//# sourceMappingURL=engine.d.ts.map