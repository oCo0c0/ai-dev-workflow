/**
 * @file 需求引擎（Facade）
 * @description 组合 MCP 配置、桥接与本地存储，对 dsh-adw 宿主半暴露
 *   「拉取 / 搜索 / 列表 / 刷新 / 执行链接」一体的高层 API。
 *   路由与 agent 工具都只依赖本引擎，不感知适配器与 MCP 细节。
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { MCPConfigService } from './mcp-config.js';
import { MCPBridgeService } from './mcp-bridge.js';
import { resolveAdapter } from './requirement-sources/index.js';
import { RequirementStore } from './store.js';
/**
 * 需求引擎
 * @description 生命周期：构造即就绪；dispose 断开全部 MCP 连接。
 */
export class RequirementEngine {
    mcpConfig;
    bridge;
    store;
    defaultServerName;
    imageUrlBasePrefix;
    constructor(opts) {
        // MCP 配置完全自管：存数据目录内，不读写任何其他工具的配置文件
        this.mcpConfig = new MCPConfigService(join(opts.dataDir, 'mcp-servers.json'));
        this.defaultServerName = opts.defaultServerName;
        this.bridge = new MCPBridgeService(this.mcpConfig, opts.defaultServerName);
        this.store = new RequirementStore(opts.dataDir);
        this.imageUrlBasePrefix = opts.imageUrlBasePrefix ?? '/api/dsh-adw/requirements';
    }
    /** 源目录（适配器视角：元数据 + 已配置 servers + 一键安装模板） */
    listSources() {
        return this.bridge.listSources();
    }
    /** 按适配器模板一键安装源（创建 MCP server + 连接测试） */
    async installSource(adapterId, env) {
        return this.bridge.installSource(adapterId, env);
    }
    /** 连接测试 */
    async testServer(serverName) {
        const result = await this.mcpConfig.testConnection(serverName, 10_000);
        const ok = result.ok ?? result.status === 'connected';
        return { ok, message: result.message };
    }
    /** 删除一个 MCP server 配置（源卸载；返回是否存在） */
    removeServer(serverName) {
        return this.mcpConfig.delete(serverName);
    }
    /**
     * 拉取需求并保存（推荐入口）
     * @param input - 用户原始输入（链接 / 编号 / issue key / owner-repo#N）
     * @returns 保存后的完整需求（含溯源 + 既有执行历史）
     */
    async fetchAndSave(input, opts) {
        const serverName = this.bridge.getResolvedServerName(opts);
        const { detail } = await this.bridge.fetchRequirementByInput(input, opts);
        // 附件图片富化（尽力而为：下载/改写失败不阻塞需求保存）
        try {
            const imageService = this.bridge.getAttachmentImageService({ serverName });
            await this.store.downloadImages(detail, imageService, `${this.imageUrlBasePrefix}/${encodeURIComponent(detail.id)}/images`);
        }
        catch { /* 图片是增强项，不阻塞主流程 */ }
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
    getImagePath(id, filename) {
        return this.store.getImagePath(id, filename) ?? undefined;
    }
    /** 源内搜索（不落库） */
    async search(query, opts) {
        return this.bridge.searchRequirements(query, opts);
    }
    /** 已保存需求列表（最近拉取在前） */
    list() {
        return this.store.list();
    }
    /** 已保存需求详情 */
    get(id) {
        return this.store.get(id);
    }
    /** 删除 */
    delete(id) {
        return this.store.delete(id);
    }
    /** 按原始输入重拉并覆盖（保留执行历史） */
    async refresh(id) {
        const existing = this.store.get(id);
        if (!existing)
            return undefined;
        return this.fetchAndSave(existing.source.input, { serverName: existing.source.serverName });
    }
    /** 记录一条执行链接（生成 executionId） */
    addExecution(id, link) {
        const full = {
            ...link,
            executionId: randomUUID(),
            startedAt: link.startedAt ?? new Date().toISOString(),
        };
        const requirement = this.store.addExecution(id, full);
        if (!requirement)
            return undefined;
        return { executionId: full.executionId, requirement };
    }
    /** 回写执行结局 */
    settleExecution(id, executionId, outcome, error) {
        return this.store.settleExecution(id, executionId, outcome, error);
    }
    /** 断开全部 MCP 连接（插件卸载时调用） */
    async dispose() {
        await this.bridge.disconnect().catch(() => undefined);
    }
}
/** 渲染开发 prompt（占位符替换，纯函数；模板来自插件设置） */
export function renderDevPrompt(template, req) {
    return template
        .replaceAll('{{title}}', req.title)
        .replaceAll('{{number}}', req.number ?? req.id)
        .replaceAll('{{id}}', req.id)
        .replaceAll('{{status}}', req.status)
        .replaceAll('{{priority}}', req.priority)
        .replaceAll('{{description}}', req.description ?? '')
        .replaceAll('{{acceptanceCriteria}}', (req.acceptanceCriteria ?? []).map(c => `- [ ] ${c}`).join('\n'));
}
//# sourceMappingURL=engine.js.map