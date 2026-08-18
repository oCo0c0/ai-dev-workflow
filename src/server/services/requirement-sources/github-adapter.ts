/**
 * @module requirement-sources/github-adapter
 * @description GitHub Issues 需求源适配器
 *
 * 对接 GitHub MCP server（@modelcontextprotocol/server-github 等）：
 * - 输入方言：`owner/repo#123`、`#123`（需 env 提供默认仓库）、GitHub issue 链接
 * - MCP 工具命名：get_issue / search_issues
 * - 响应格式：GitHub Issues REST JSON（state / user.login / body）
 * - 附件：图床 URL 公开可直连，无需认证服务（暂不下载）
 */

import type {MCPServerConfig} from '../mcp-config-service.js';
import type {RequirementSourceAdapter, RequirementDetail, Requirement, ToolCapability} from './types.js';
import {extractContentJson, parseAttachments, parseRelatedIssues} from './parsers.js';

/** GitHub 工具能力 → 工具名匹配模式 */
const CAPABILITY_PATTERNS: Record<ToolCapability, RegExp[]> = {
    fetchDetail: [
        /^get_issue$/,
        /^(get|fetch|read)_issues?$/, // 变体兜底
    ],
    search: [
        /^search_issues$/,
        /^search_(?:issue|issues)$/,
    ],
};

/** 已知版本的候选工具名（兜底） */
const FALLBACK_TOOL_NAMES: Record<ToolCapability, string[]> = {
    fetchDetail: ['get_issue'],
    search: ['search_issues'],
};

/** 从 GitHub issue 链接提取 owner/repo/number：https://github.com/{owner}/{repo}/issues/{n} */
function parseIssueUrl(url: string): { owner: string; repo: string; number: number } | undefined {
    const m = url.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i);
    if (!m) return undefined;
    return {owner: m[1], repo: m[2].replace(/\.git$/, ''), number: Number(m[3])};
}

/** GitHub issue JSON 的宽松形态 */
interface GithubIssueJson {
    number?: number;
    id?: number;
    title?: string;
    state?: string;
    body?: string | null;
    html_url?: string;
    updated_at?: string;
    user?: { login?: string };
    assignee?: { login?: string } | null;
    labels?: Array<{ name?: string }>;
    milestone?: { title?: string } | null;
}

/**
 * GitHub 需求源适配器
 */
export class GithubAdapter implements RequirementSourceAdapter {
    readonly id = 'github';
    readonly label = 'GitHub Issues';
    readonly description = 'GitHub 仓库的 Issues：按 issue 链接 / owner/repo#编号 拉取需求详情与检查项';
    readonly capabilityPatterns = CAPABILITY_PATTERNS;
    readonly fallbackToolNames = FALLBACK_TOOL_NAMES;
    readonly installTemplate = {
        serverName: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        envSpecs: [
            {
                key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
                label: 'Personal Access Token',
                required: true,
                secret: true,
                hint: 'GitHub → Settings → Developer settings → Personal access tokens 生成（需 repo 读取权限）',
            },
            {
                key: 'GITHUB_REPOSITORY',
                label: '默认仓库（owner/repo）',
                required: false,
                hint: '配置后可直接输入 issue 编号（如 42），否则需输入 owner/repo#42',
            },
        ],
        instructions: '使用官方 @modelcontextprotocol/server-github 连接 GitHub。',
    };

    /**
     * 认领 GitHub 系 MCP server 配置
     * @description 服务器名或命令/参数中含 "github"（github / server-github /
     *   github-mcp-server 等）
     */
    matchServer(config: MCPServerConfig): boolean {
        const name = (config.name ?? '').toLowerCase();
        const cmdline = [config.command, ...(config.args ?? [])].join(' ').toLowerCase();
        return name.includes('github') || cmdline.includes('github');
    }

    /**
     * 规整用户输入
     *
     * 支持的输入形态：
     *  - GitHub issue 链接：https://github.com/owner/repo/issues/123 → owner/repo#123
     *  - owner/repo#123 → 原样（小写规整）
     *  - #123 / 123 → 原样（buildDetailArgs 时结合 env 默认仓库）
     */
    normalizeInput(raw: string): string {
        const s = raw.trim();
        const fromUrl = parseIssueUrl(s);
        if (fromUrl) {
            return `${fromUrl.owner}/${fromUrl.repo}#${fromUrl.number}`;
        }
        // owner/repo#123 归一：去空格、repo 去掉 .git 后缀
        const m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?#(\d+)$/i);
        if (m) return `${m[1]}/${m[2]}#${m[3]}`;
        // #123 去前缀，保持纯数字
        return s.replace(/^#/, '');
    }

    /**
     * 裸编号不做预搜索
     * @description GitHub 全局搜索 '42' 会命中全网仓库的 issue，无法定位本仓库；
     *   裸编号的正确解析路径是 buildDetailArgs 的仓库限定（owner/repo#N 输入或
     *   GITHUB_REPOSITORY env），缺省时由 buildDetailArgs 抛出可操作错误。
     *   返回 undefined 跳过桥接层的"纯编号先搜索"步骤。
     */
    extractPlainNumber(): undefined {
        return undefined;
    }

    /**
     * 构建详情工具参数
     * @description get_issue 需要 owner/repo/issue_number 三参数；
     *   裸编号从 MCP env 的 GITHUB_REPOSITORY（'owner/repo'，GitHub Actions 同名约定）补全。
     */
    buildDetailArgs(normalizedInput: string, config: MCPServerConfig): Record<string, unknown> {
        const full = normalizedInput.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/i);
        if (full) {
            return {owner: full[1], repo: full[2], issue_number: Number(full[3])};
        }
        const num = normalizedInput.match(/^(\d+)$/);
        if (num) {
            const defaultRepo = config.env?.GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
            if (defaultRepo) {
                const [owner, repo] = defaultRepo.split('/');
                if (owner && repo) {
                    return {owner, repo, issue_number: Number(num[1])};
                }
            }
            throw new Error(
                `GitHub issue 需要仓库限定：请输入 owner/repo#${num[1]}，或在 MCP server 的 env 中配置 GITHUB_REPOSITORY=owner/repo`
            );
        }
        // 其它形态（链接等）原样透传，由上游工具判定
        return {id: normalizedInput};
    }

    /** search_issues 以 GitHub 搜索语法查询 */
    buildSearchArgs(query: string): Record<string, unknown> {
        return {q: query};
    }

    parseDetail(content: unknown): RequirementDetail {
        const raw = extractContentJson(content);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return this.mapIssueToDetail(raw as unknown as GithubIssueJson);
        }
        throw new Error('Invalid GitHub issue response');
    }

    parseList(content: unknown): Requirement[] {
        const raw = extractContentJson(content);
        // search_issues / list 返回条目数组（可能包在 items 字段里）
        const items = Array.isArray(raw)
            ? raw
            : (raw && typeof raw === 'object' && Array.isArray((raw as {items?: unknown[]}).items)
                ? (raw as {items: unknown[]}).items
                : null);
        if (!items) return [];
        return items.map((item) => this.mapIssueToDetail(item as unknown as GithubIssueJson));
    }

    /** GitHub 不提供附件认证下载（图床公开直连），暂不构建图片服务 */
    createImageService(): undefined {
        return undefined;
    }

    /** GitHub issue JSON → 中立需求模型 */
    private mapIssueToDetail(issue: GithubIssueJson): RequirementDetail {
        const labels = (issue.labels ?? []).map(l => l.name ?? '').filter(Boolean);
        // GitHub 无内建优先级：按 label 约定推断（P0/p0/critical → high 等）
        const priority = inferPriority(labels);
        return {
            id: String(issue.number ?? issue.id ?? ''),
            number: issue.number !== undefined ? `#${issue.number}` : undefined,
            title: String(issue.title ?? ''),
            status: String(issue.state ?? 'unknown'),
            priority,
            assignee: String(issue.assignee?.login ?? issue.user?.login ?? ''),
            updatedAt: String(issue.updated_at ?? new Date().toISOString()),
            description: String(issue.body ?? ''),
            acceptanceCriteria: extractChecklist(String(issue.body ?? '')),
            attachments: parseAttachments(extractImageLinks(String(issue.body ?? ''))),
            relatedIssues: parseRelatedIssues([]),
        };
    }
}

/** 按 label 约定推断优先级 */
function inferPriority(labels: string[]): string {
    const joined = labels.join(' ').toLowerCase();
    if (/\bp0\b|critical|urgent|blocker/.test(joined)) return 'high';
    if (/\bp2\b|low|minor/.test(joined)) return 'low';
    return 'medium';
}

/** 从 Markdown body 提取 checklist 项作为验收标准 */
function extractChecklist(body: string): string[] {
    const items: string[] = [];
    for (const line of body.split('\n')) {
        const m = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/);
        if (m) items.push(m[1].trim());
    }
    return items;
}

/** 从 Markdown body 提取内嵌图片链接作为附件 */
function extractImageLinks(body: string): Array<{ name: string; url: string; type: string }> {
    const links: Array<{ name: string; url: string; type: string }> = [];
    const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
        const url = match[2].split(/\s+/)[0];
        const ext = url.match(/\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? 'png';
        links.push({
            name: match[1] || url.split('/').pop()?.split('?')[0] || `image-${links.length + 1}`,
            url,
            type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        });
    }
    return links;
}
