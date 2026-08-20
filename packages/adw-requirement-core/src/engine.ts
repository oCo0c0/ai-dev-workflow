/**
 * @file 需求引擎（Facade）
 * @description 组合 MCP 配置、桥接与本地存储，对 dsh-adw 宿主半暴露
 *   「拉取 / 搜索 / 列表 / 刷新 / 执行链接」一体的高层 API。
 *   路由与 agent 工具都只依赖本引擎，不感知适配器与 MCP 细节。
 */

import {randomUUID} from 'crypto';
import {join} from 'path';
import {MCPConfigService} from './mcp-config.js';
import {MCPBridgeService, type RequirementSourceEntry} from './mcp-bridge.js';
import {resolveAdapter} from './requirement-sources/index.js';
import type {Requirement, RequirementDetail} from './requirement-sources/types.js';
import {RequirementStore, type ExecutionLink, type SavedRequirement} from './store.js';

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
export class RequirementEngine {
    private readonly mcpConfig: MCPConfigService;
    private readonly bridge: MCPBridgeService;
    private readonly store: RequirementStore;
    private readonly defaultServerName?: string;
    private readonly imageUrlBasePrefix: string;

    constructor(opts: EngineOptions) {
        // MCP 配置完全自管：存数据目录内，不读写任何其他工具的配置文件
        this.mcpConfig = new MCPConfigService(join(opts.dataDir, 'mcp-servers.json'));
        this.defaultServerName = opts.defaultServerName;
        this.bridge = new MCPBridgeService(this.mcpConfig, opts.defaultServerName);
        this.store = new RequirementStore(opts.dataDir);
        this.imageUrlBasePrefix = opts.imageUrlBasePrefix ?? '/api/dsh-adw/requirements';
    }

    /** 源目录（适配器视角：元数据 + 已配置 servers + 一键安装模板） */
    listSources(): RequirementSourceEntry[] {
        return this.bridge.listSources();
    }

    /** 按适配器模板一键安装源（创建 MCP server + 连接测试） */
    async installSource(adapterId: string, env: Record<string, string>): Promise<{serverName: string; connectionTest?: {ok: boolean; message: string}}> {
        return this.bridge.installSource(adapterId, env);
    }

    /** 连接测试 */
    async testServer(serverName: string): Promise<{ok: boolean; message: string}> {
        const result = await this.mcpConfig.testConnection(serverName, 10_000);
        const ok = (result as {ok?: boolean}).ok ?? result.status === 'connected';
        return {ok, message: result.message};
    }

    /** 删除一个 MCP server 配置（源卸载；返回是否存在） */
    removeServer(serverName: string): boolean {
        return this.mcpConfig.delete(serverName);
    }

    /** 列出自管文件中的全部 MCP 服务器（含 url 型自定义服务器） */
    listServers(): Array<import('./mcp-config.js').MCPServerConfig> {
        return this.mcpConfig.list();
    }

    /** 添加自定义 MCP 服务器（stdio command/args 或 http url），返回添加结果 */
    addServer(config: {name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string}): import('./mcp-config.js').MCPServerConfig {
        return this.mcpConfig.add({
            name: config.name,
            type: 'custom',
            command: config.command ?? '',
            args: config.args ?? [],
            env: config.env ?? {},
            ...(config.url !== undefined ? {url: config.url} : {}),
            enabled: true,
        });
    }
    /**
     * 拉取需求并保存（推荐入口）
     * @param input - 用户原始输入（链接 / 编号 / issue key / owner-repo#N）
     * @returns 保存后的完整需求（含溯源 + 既有执行历史）
     */
    async fetchAndSave(input: string, opts?: FetchOptions): Promise<SavedRequirement> {
        const serverName = this.bridge.getResolvedServerName(opts);
        const {detail} = await this.bridge.fetchRequirementByInput(input, opts);
        // 附件图片富化（尽力而为：下载/改写失败不阻塞需求保存）
        try {
            const imageService = this.bridge.getAttachmentImageService({serverName});
            await this.store.downloadImages(
                detail,
                imageService,
                `${this.imageUrlBasePrefix}/${encodeURIComponent(detail.id)}/images`,
            );
        } catch { /* 图片是增强项，不阻塞主流程 */ }
        const config = this.mcpConfig.get(serverName);
        const adapterId = resolveAdapter(serverName, config).id;
        return this.store.upsert(detail, {
            adapterId,
            serverName,
            input: input.trim(),
            fetchedAt: new Date().toISOString(),
        });
    }

    /** 本地图片文件路径（宿主静态路由用；不存在/不安全返回 undefined） */
    getImagePath(id: string, filename: string): string | undefined {
        return this.store.getImagePath(id, filename) ?? undefined;
    }

    /** 源内搜索（不落库） */
    async search(query: string, opts?: FetchOptions): Promise<Requirement[]> {
        return this.bridge.searchRequirements(query, opts);
    }

    /** 已保存需求列表（最近拉取在前） */
    list(): SavedRequirement[] {
        return this.store.list();
    }

    /** 已保存需求详情 */
    get(id: string): SavedRequirement | undefined {
        return this.store.get(id);
    }

    /** 删除 */
    delete(id: string): boolean {
        return this.store.delete(id);
    }

    /** 按原始输入重拉并覆盖（保留执行历史） */
    async refresh(id: string): Promise<SavedRequirement | undefined> {
        const existing = this.store.get(id);
        if (!existing) return undefined;
        return this.fetchAndSave(existing.source.input, {serverName: existing.source.serverName});
    }

    /** 记录一条执行链接（生成 executionId） */
    addExecution(id: string, link: Omit<ExecutionLink, 'executionId' | 'startedAt'> & {startedAt?: string}): {executionId: string; requirement: SavedRequirement} | undefined {
        const full: ExecutionLink = {
            ...link,
            executionId: randomUUID(),
            startedAt: link.startedAt ?? new Date().toISOString(),
        };
        const requirement = this.store.addExecution(id, full);
        if (!requirement) return undefined;
        return {executionId: full.executionId, requirement};
    }

    /** 回写执行结局 */
    settleExecution(id: string, executionId: string, outcome: ExecutionLink['outcome'], error?: string): SavedRequirement | undefined {
        return this.store.settleExecution(id, executionId, outcome, error);
    }

    /** 断开全部 MCP 连接（插件卸载时调用） */
    async dispose(): Promise<void> {
        await this.bridge.disconnect().catch(() => undefined);
    }
}

/** 渲染开发 prompt（占位符替换，纯函数；模板来自插件设置） */
export function renderDevPrompt(template: string, req: RequirementDetail): string {
    return template
        .replaceAll('{{title}}', req.title)
        .replaceAll('{{number}}', req.number ?? req.id)
        .replaceAll('{{id}}', req.id)
        .replaceAll('{{status}}', req.status)
        .replaceAll('{{priority}}', req.priority)
        .replaceAll('{{description}}', req.description ?? '')
        .replaceAll('{{acceptanceCriteria}}', (req.acceptanceCriteria ?? []).map(c => `- [ ] ${c}`).join('\n'));
}
