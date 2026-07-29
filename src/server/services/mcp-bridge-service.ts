/**
 * @file MCP 桥接服务
 * @description 提供与 MCP (Model Context Protocol) 服务器之间的通信桥接能力。
 *   通过标准化的 MCP 客户端协议，支持从外部需求管理工具（如 ONES、Jira、GitLab 等）
 *   获取需求详情、搜索需求列表等操作。该服务采用懒连接策略，仅在首次调用时建立连接，
 *   并支持动态切换目标 MCP 服务器。
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {MCPConfigService, MCPServerConfig} from './mcp-config-service.js';
import {getErrorMessage} from '../utils/error-utils.js';

// === 数据模型定义 ===

/**
 * 需求基本信息接口
 * @description 表示从 MCP 服务器获取的需求摘要信息，用于列表展示和搜索结果
 */
export interface Requirement {
    /** 需求唯一标识符 */
    id: string;
    /** 需求编号（如 #91086），用户可识别的编号 */
    number?: string;
    /** 需求标题 */
    title: string;
    /** 需求状态（如 open、in_progress、closed 等） */
    status: string;
    /** 需求优先级（如 high、medium、low） */
    priority: string;
    /** 需求负责人 */
    assignee: string;
    /** 最后更新时间（ISO 8601 格式） */
    updatedAt: string;
}

/**
 * 需求详细信息接口
 * @description 继承 Requirement，包含需求的完整详情，用于详情页面展示
 */
export interface RequirementDetail extends Requirement {
    /** 需求详细描述内容 */
    description: string;
    /** 验收标准列表 */
    acceptanceCriteria: string[];
    /** 附件列表 */
    attachments: Attachment[];
    /** 关联问题列表 */
    relatedIssues: RelatedIssue[];
}

/**
 * 附件信息接口
 * @description 表示需求关联的附件文件
 */
interface Attachment {
    /** 附件文件名 */
    name: string;
    /** 附件访问 URL */
    url: string;
    /** 附件 MIME 类型 */
    type: string;
}

/**
 * 关联问题接口
 * @description 表示与当前需求关联的其他问题/缺陷
 */
export interface RelatedIssue {
    /** 关联问题的唯一标识符 */
    id: string;
    /** 关联问题的标题 */
    title: string;
    /** 关联问题的状态 */
    status: string;
}

// === MCP 桥接服务 ===

/**
 * MCP 桥接服务类
 * @description 封装了与 MCP 服务器的通信逻辑，提供需求获取和搜索的统一接口。
 *   核心特性包括：
 *   - 懒连接：仅在首次调用时建立与 MCP 服务器的连接
 *   - 连接复用：已建立的连接会被缓存，后续调用直接复用
 *   - 并发保护：通过 connecting 标志位防止重复连接
 *   - 动态切换：支持运行时切换目标 MCP 服务器
 *   - 多格式解析：支持 JSON 和 Markdown 两种 MCP 响应格式的解析
 */
export class MCPBridgeService {
    /** MCP 配置服务实例，用于获取服务器连接配置 */
    private mcpConfigService: MCPConfigService;
    /** 当前使用的 MCP 服务器名称，默认为 'ones-api' */
    private serverName: string;
    /** MCP 客户端实例，为 null 表示尚未连接 */
    private client: Client | null = null;
    /** 连接中标志位，防止并发连接请求导致的竞争条件 */
    private connecting: boolean = false;

    /**
     * 构造函数
     * @param mcpConfigService - MCP 配置服务实例，提供服务器配置信息
     * @param serverName - 可选的 MCP 服务器名称，默认为 'ones-api'
     */
    constructor(mcpConfigService: MCPConfigService, serverName?: string) {
        this.mcpConfigService = mcpConfigService;
        this.serverName = serverName ?? 'ones-api';
    }

    /**
     * 确保 MCP 客户端连接可用
     * @description 采用懒连接策略，仅在首次调用时建立连接。如果已有活跃连接则直接返回。
     *   当检测到有其他调用正在进行连接时，等待 1 秒后再次检查连接状态。
     * @returns 已连接的 MCP 客户端实例
     * @throws 当服务器未配置或连接失败时抛出错误
     */
    private async ensureConnected(): Promise<Client> {
        // 已有连接，直接复用
        if (this.client) return this.client;

        // 有其他调用正在连接，等待后检查
        if (this.connecting) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.client) return this.client;
            throw new Error('Connection already in progress');
        }

        this.connecting = true;
        try {
            const config = this.getServerConfig();
            if (!config) {
                throw new Error(
                    `MCP Server "${this.serverName}" is not configured. Please add it in MCP Management.`
                );
            }

            // 创建基于标准输入输出的传输层，合并当前进程环境变量与服务器自定义环境变量
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: {...process.env, ...config.env} as Record<string, string>,
            });

            // 创建 MCP 客户端，标识为 ai-dev-workbench
            const client = new Client(
                {name: 'ai-dev-workbench', version: '0.1.0'},
                {capabilities: {}}
            );

            await client.connect(transport);
            this.client = client;
            return client;
        } finally {
            // 无论连接成功与否，都重置连接中标志位
            this.connecting = false;
        }
    }

    /**
     * 断开与 MCP 服务器的连接并释放资源
     */
    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }

    /**
     * 获取指定需求的详细信息
     * @param id - 需求的唯一标识符
     * @returns 需求详细信息对象
     * @throws 当获取失败时抛出包含需求 ID 和原始错误信息的错误
     */
    async fetchRequirementDetail(id: string): Promise<RequirementDetail> {
        try {
            const client = await this.ensureConnected();
            const result = await client.callTool({name: 'get_requirement', arguments: {id}});
            return this.parseRequirementDetail(result.content);
        } catch (err) {
            throw new Error(
                `Failed to fetch requirement detail for "${id}": ${getErrorMessage(err)}`
            );
        }
    }

    /**
     * 按关键字搜索需求列表
     * @param query - 搜索关键字
     * @returns 匹配的需求列表
     * @throws 当搜索失败时抛出包含原始错误信息的错误
     */
    async searchRequirements(query: string): Promise<Requirement[]> {
        try {
            const client = await this.ensureConnected();
            const result = await client.callTool({name: 'search_requirements', arguments: {query}});
            return this.parseRequirementList(result.content);
        } catch (err) {
            throw new Error(
                `Failed to search requirements: ${getErrorMessage(err)}`
            );
        }
    }

    /**
     * 获取当前配置的 MCP 服务器名称
     * @returns 当前 MCP 服务器名称
     */
    getServerName(): string {
        return this.serverName;
    }

    /**
     * 设置要使用的 MCP 服务器名称
     * @description 设置新名称后会自动断开当前连接，确保下次调用时重新连接到新服务器
     * @param name - 新的 MCP 服务器名称
     */
    setServerName(name: string): void {
        this.serverName = name;
        // 断开当前连接，以便下次调用时重新连接到新服务器
        this.disconnect().catch(() => {
        });
    }

    // === 私有方法 ===

    /**
     * 获取当前 MCP 服务器的配置信息（公开方法，供路由层读取认证参数等）
     * @returns 服务器配置对象，如果未配置则返回 undefined
     */
    getServerConfig(): MCPServerConfig | undefined {
        return this.mcpConfigService.get(this.serverName);
    }

    /**
     * 从 MCP 工具调用结果中提取纯文本内容
     * @description MCP 工具返回的内容格式为数组，每个元素为 { type: 'text', text: '...' } 结构。
     *   该方法遍历数组找到第一个文本类型的元素并返回其文本值。
     * @param content - MCP 工具调用的原始返回内容
     * @returns 提取到的文本字符串，如果没有找到则返回 null
     */
    private extractContentText(content: unknown): string | null {
        if (!content || !Array.isArray(content) || content.length === 0) {
            return null;
        }
        const textItem = content.find(
            (item: Record<string, unknown>) => item.type === 'text' && typeof item.text === 'string'
        );
        return textItem ? (textItem as { text: string }).text : null;
    }

    /**
     * 从 MCP 工具调用结果中提取 JSON 数据
     * @description 先提取纯文本，然后尝试解析为 JSON。如果解析失败则返回原始文本。
     * @param content - MCP 工具调用的原始返回内容
     * @returns 解析后的 JSON 对象、原始文本字符串或 null
     */
    private extractContentJson(content: unknown): unknown {
        const text = this.extractContentText(content);
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            // JSON 解析失败，返回原始文本
            return text;
        }
    }

    /**
     * 将 MCP 原始响应内容解析为需求列表
     * @description 支持两种响应格式：
     *   1. JSON 数组格式：直接映射每个对象的字段
     *   2. Markdown 文本格式：通过正则表达式逐行解析 Markdown 结构
     * @param content - MCP 工具调用的原始返回内容
     * @returns 解析后的需求列表，无法解析时返回空数组
     */
    private parseRequirementList(content: unknown): Requirement[] {
        const raw = this.extractContentJson(content);

        // JSON 数组格式：直接映射字段，对缺失字段使用默认值
        if (Array.isArray(raw)) {
            return raw.map((item: Record<string, unknown>) => ({
                id: String(item.id ?? ''),
                title: String(item.title ?? ''),
                status: String(item.status ?? 'unknown'),
                priority: String(item.priority ?? 'medium'),
                assignee: String(item.assignee ?? ''),
                updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
            }));
        }

        // Markdown 文本格式：解析每个 ### 开头的段落
        if (typeof raw === 'string') {
            return this.parseMarkdownRequirementList(raw);
        }

        return [];
    }

    /**
     * 解析 Markdown 格式的需求列表
     * @description 逐行扫描 Markdown 文本，匹配格式为 "### [STATUS] ID: #NUMBER Title" 的行，
     *   并从后续行中提取优先级和负责人等元数据信息。
     * @param text - Markdown 格式的需求列表文本
     * @returns 解析后的需求列表
     */
    private parseMarkdownRequirementList(text: string): Requirement[] {
        const results: Requirement[] = [];
        const lines = text.split('\n');

        for (const line of lines) {
            // 匹配格式：### [STATUS] ID: #NUMBER Title
            const match = line.match(/^###\s+\[([^\]]+)\]\s+(\S+):\s+(.+)$/);
            if (match) {
                const [, status, id, titlePart] = match;
                // titlePart 格式可能为 "#130770 Title text"，需要提取编号和纯标题文本
                const numberMatch = titlePart.match(/^#(\d+)/);
                const titleMatch = titlePart.match(/^#\d+\s+(.+)$/) ?? titlePart.match(/^(.+)$/);
                const title = titleMatch ? titleMatch[1].trim() : titlePart.trim();

                // 从当前行之后最多 6 行中提取优先级和负责人元数据
                let priority = 'medium';
                let assignee = '';
                const lineIdx = lines.indexOf(line);
                for (let i = lineIdx + 1; i < Math.min(lineIdx + 6, lines.length); i++) {
                    const meta = lines[i];
                    if (meta.includes('Priority:')) {
                        const m = meta.match(/Priority:\s*(\w+)/i);
                        if (m) priority = m[1].toLowerCase();
                    }
                    if (meta.includes('Assignee:')) {
                        const m = meta.match(/Assignee:\s*(.+)/i);
                        if (m) assignee = m[1].trim();
                    }
                    // 遇到下一个需求标题时停止扫描元数据
                    if (lines[i].startsWith('###')) break;
                }

                results.push({
                    id,
                    number: numberMatch ? `#${numberMatch[1]}` : undefined,
                    title,
                    status: status.toLowerCase(),
                    priority,
                    assignee,
                    updatedAt: new Date().toISOString(),
                });
            }
        }

        return results;
    }

    /**
     * 将 MCP 原始响应内容解析为需求详情
     * @description 支持两种响应格式：
     *   1. JSON 对象格式：直接映射所有字段，包括嵌套的验收标准、附件和关联问题
     *   2. Markdown 文本格式：通过正则表达式解析 Markdown 结构化的需求详情
     * @param content - MCP 工具调用的原始返回内容
     * @returns 解析后的需求详情对象
     * @throws 当响应内容无法解析为有效格式时抛出错误
     */
    private parseRequirementDetail(content: unknown): RequirementDetail {
        const raw = this.extractContentJson(content);

        // JSON 对象格式：支持驼峰和下划线两种字段命名风格
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const data = raw as Record<string, unknown>;
            return {
                id: String(data.id ?? ''),
                number: data.number ? String(data.number) : undefined,
                title: String(data.title ?? ''),
                status: String(data.status ?? 'unknown'),
                priority: String(data.priority ?? 'medium'),
                assignee: String(data.assignee ?? ''),
                updatedAt: String(data.updatedAt ?? data.updated_at ?? new Date().toISOString()),
                description: String(data.description ?? ''),
                // 兼容驼峰命名（acceptanceCriteria）和下划线命名（acceptance_criteria）
                acceptanceCriteria: this.parseStringArray(data.acceptanceCriteria ?? data.acceptance_criteria),
                attachments: this.parseAttachments(data.attachments),
                relatedIssues: this.parseRelatedIssues(data.relatedIssues ?? data.related_issues),
            };
        }

        // Markdown 文本格式
        if (typeof raw === 'string') {
            return this.parseMarkdownRequirementDetail(raw);
        }

        throw new Error('Invalid requirement detail response');
    }

    /**
     * 解析 Markdown 格式的需求详情
     * @description ones-api MCP 返回的 Markdown 格式示例如下：
     *   ```
     *   # #130770 Title
     *   - **ID**: RbSvp3zzkJyHJ47Y
     *   - **Status**: open
     *   ...
     *   ---
     *   ## Requirement Detail
     *   actual description content here
     *   ```
     *   该方法按优先级依次尝试多个章节名称来提取描述内容，
     *   并支持中英文的验收标准章节名称。
     * @param text - Markdown 格式的需求详情文本
     * @returns 解析后的需求详情对象
     */
    private parseMarkdownRequirementDetail(text: string): RequirementDetail {
        const lines = text.split('\n');

        let id = '';
        let title = '';
        let number: string | undefined;
        let status = 'unknown';
        let priority = 'medium';
        let assignee = '';
        const acceptanceCriteria: string[] = [];

        // 从第一个一级标题中解析需求标题和编号
        const titleLine = lines.find(l => l.startsWith('# '));
        if (titleLine) {
            // 提取 #NUMBER 编号（如 #91086）
            const numberMatch = titleLine.match(/^#\s+#(\d+)/);
            if (numberMatch) number = `#${numberMatch[1]}`;
            // 移除前导 "# " 和可选的 "#NUMBER " 前缀
            const cleaned = titleLine.replace(/^#\s+/, '').replace(/^#\d+\s+/, '').trim();
            title = cleaned;
        }

        // 从无序列表项 (- **Key**: Value) 中解析元数据字段
        for (const line of lines) {
            const idMatch = line.match(/\*\*(?:ID|UUID)\*\*:\s*(\S+)/);
            if (idMatch) id = idMatch[1];

            const statusMatch = line.match(/\*\*Status\*\*:\s*(.+)/i);
            if (statusMatch) status = statusMatch[1].trim();

            const priorityMatch = line.match(/\*\*Priority\*\*:\s*(.+)/i);
            if (priorityMatch) priority = priorityMatch[1].trim().toLowerCase();

            const assigneeMatch = line.match(/\*\*Assignee\*\*:\s*(.+)/i);
            if (assigneeMatch) assignee = assigneeMatch[1].trim();
        }

        // 按优先级顺序尝试查找需求描述章节
        // 优先使用 "Requirement Documents"（ONES 标准文档章节）和 "Requirement Detail"，
        // "Description" 章节可能包含嵌套的元数据内容故优先级较低
        const sectionOrder = [
            'Requirement Documents', 'Requirement Detail',
            'Description', '需求详情', '需求文档', '详情', 'Content',
        ];

        let description = '';
        for (const sectionName of sectionOrder) {
            const pattern = new RegExp(`^##\\s+${sectionName}`, 'i');
            const idx = lines.findIndex(l => pattern.test(l));
            if (idx >= 0) {
                // 收集章节内容
                const descLines: string[] = [];
                // 文档类章节（如 Requirement Documents）：内容中含二级标题，只在 ## Attachments 时停止
                // 元数据类章节（如 Description）：遇到下一个 ## 即停止
                // 注意：wiki URL 直拉时正文位于 ## Description 下，且正文自带 ## 子标题，
                // 故 Description / 需求详情 也按文档类处理，否则会在第一个 ## 处截断丢内容
                const isDocSection = /Requirement Documents|Requirement Detail|Description|需求文档|需求详情/i.test(sectionName);
                for (let i = idx + 1; i < lines.length; i++) {
                    if (isDocSection) {
                        // 文档章节：仅在遇到 ## Attachments（MCP 尾部结构）时停止
                        if (/^##\s+Attachments/i.test(lines[i])) break;
                    } else {
                        // 元数据章节：遇到同级 ## 标题时停止
                        if (lines[i].startsWith('## ')) break;
                    }
                    descLines.push(lines[i]);
                }
                const candidate = descLines.join('\n').trim();
                // 空内容跳过，继续下一个 section
                if (!candidate) continue;
                // 如果内容看起来像元数据（包含 **Type**: 或 **UUID**: 模式），
                // 且不是最后一个备选章节，则继续查找更好的章节
                const looksLikeMetadata = candidate.includes('**Type**:') || candidate.includes('**UUID**:');
                if (!looksLikeMetadata || sectionName === sectionOrder[sectionOrder.length - 1]) {
                    description = candidate;
                    break;
                }
            }
        }

        // 兜底策略：取最后一个 --- 分隔符之后的所有内容作为描述
        if (!description) {
            const lastSepIdx = lines.lastIndexOf('---');
            if (lastSepIdx >= 0) {
                description = lines.slice(lastSepIdx + 1).join('\n').trim();
            }
        }

        // 解析验收标准章节（支持中英文标题）
        const acIdx = lines.findIndex(l => /^##\s+(Acceptance Criteria|验收标准)/i.test(l));
        if (acIdx >= 0) {
            for (let i = acIdx + 1; i < lines.length; i++) {
                if (lines[i].startsWith('## ')) break;
                const acMatch = lines[i].match(/^[-*]\s+(.+)/);
                if (acMatch) acceptanceCriteria.push(acMatch[1].trim());
            }
        }

        // 解析附件章节：- [filename](url) (type, size)
        const parsedAttachments: Attachment[] = [];
        const attIdx = lines.findIndex(l => /^##\s+Attachments/i.test(l));
        if (attIdx >= 0) {
            for (let i = attIdx + 1; i < lines.length; i++) {
                if (lines[i].startsWith('## ')) break;
                const attMatch = lines[i].match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:\(([^)]+)\))?/);
                if (attMatch) {
                    parsedAttachments.push({
                        name: attMatch[1],
                        url: attMatch[2],
                        type: attMatch[3]?.split(',')[0]?.trim() || 'file',
                    });
                }
            }
        }

        // 解析关联任务章节：- #id title [type] (status) — assignee
        const parsedRelated: RelatedIssue[] = [];
        const relIdx = lines.findIndex(l => /^##\s+Related Tasks/i.test(l));
        if (relIdx >= 0) {
            for (let i = relIdx + 1; i < lines.length; i++) {
                if (lines[i].startsWith('## ')) break;
                const relMatch = lines[i].match(/^[-*]\s+#?(\d+)\s+(.+?)\s+\[([^\]]+)\]\s+\(([^)]+)\)/);
                if (relMatch) {
                    parsedRelated.push({
                        id: relMatch[1],
                        title: relMatch[2].trim(),
                        status: relMatch[4].trim(),
                    });
                }
            }
        }

        return {
            id,
            number,
            title,
            status,
            priority,
            assignee,
            updatedAt: new Date().toISOString(),
            description,
            acceptanceCriteria,
            attachments: parsedAttachments,
            relatedIssues: parsedRelated,
        };
    }

    /**
     * 将未知类型的安全转换为字符串数组
     * @param raw - 待转换的原始值
     * @returns 字符串数组，如果输入无效则返回空数组
     */
    private parseStringArray(raw: unknown): string[] {
        if (!raw || !Array.isArray(raw)) {
            return [];
        }
        return raw.map((item) => String(item));
    }

    /**
     * 将未知类型的安全转换为附件数组
     * @param raw - 待转换的原始值
     * @returns 附件对象数组，如果输入无效则返回空数组
     */
    private parseAttachments(raw: unknown): Attachment[] {
        if (!raw || !Array.isArray(raw)) {
            return [];
        }
        return raw.map((item: Record<string, unknown>) => ({
            name: String(item.name ?? ''),
            url: String(item.url ?? ''),
            type: String(item.type ?? 'file'),
        }));
    }

    /**
     * 将未知类型的安全转换为关联问题数组
     * @param raw - 待转换的原始值
     * @returns 关联问题对象数组，如果输入无效则返回空数组
     */
    private parseRelatedIssues(raw: unknown): RelatedIssue[] {
        if (!raw || !Array.isArray(raw)) {
            return [];
        }
        return raw.map((item: Record<string, unknown>) => ({
            id: String(item.id ?? ''),
            title: String(item.title ?? ''),
            status: String(item.status ?? 'unknown'),
        }));
    }
}
