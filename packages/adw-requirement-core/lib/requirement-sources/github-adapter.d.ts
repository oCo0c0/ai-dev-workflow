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
import type { MCPServerConfig } from '../mcp-config.js';
import type { RequirementSourceAdapter, RequirementDetail, Requirement, ToolCapability } from './types.js';
/**
 * GitHub 需求源适配器
 */
export declare class GithubAdapter implements RequirementSourceAdapter {
    readonly id = "github";
    readonly label = "GitHub Issues";
    readonly description = "GitHub \u4ED3\u5E93\u7684 Issues\uFF1A\u6309 issue \u94FE\u63A5 / owner/repo#\u7F16\u53F7 \u62C9\u53D6\u9700\u6C42\u8BE6\u60C5\u4E0E\u68C0\u67E5\u9879";
    readonly capabilityPatterns: Record<ToolCapability, RegExp[]>;
    readonly fallbackToolNames: Record<ToolCapability, string[]>;
    readonly installTemplate: {
        serverName: string;
        command: string;
        args: string[];
        envSpecs: ({
            key: string;
            label: string;
            required: boolean;
            secret: boolean;
            hint: string;
        } | {
            key: string;
            label: string;
            required: boolean;
            hint: string;
            secret?: undefined;
        })[];
        instructions: string;
    };
    /**
     * 认领 GitHub 系 MCP server 配置
     * @description 服务器名或命令/参数中含 "github"（github / server-github /
     *   github-mcp-server 等）
     */
    matchServer(config: MCPServerConfig): boolean;
    /**
     * 规整用户输入
     *
     * 支持的输入形态：
     *  - GitHub issue 链接：https://github.com/owner/repo/issues/123 → owner/repo#123
     *  - owner/repo#123 → 原样（小写规整）
     *  - #123 / 123 → 原样（buildDetailArgs 时结合 env 默认仓库）
     */
    normalizeInput(raw: string): string;
    /**
     * 裸编号不做预搜索
     * @description GitHub 全局搜索 '42' 会命中全网仓库的 issue，无法定位本仓库；
     *   裸编号的正确解析路径是 buildDetailArgs 的仓库限定（owner/repo#N 输入或
     *   GITHUB_REPOSITORY env），缺省时由 buildDetailArgs 抛出可操作错误。
     *   返回 undefined 跳过桥接层的"纯编号先搜索"步骤。
     */
    extractPlainNumber(): undefined;
    /**
     * 构建详情工具参数
     * @description get_issue 需要 owner/repo/issue_number 三参数；
     *   裸编号从 MCP env 的 GITHUB_REPOSITORY（'owner/repo'，GitHub Actions 同名约定）补全。
     */
    buildDetailArgs(normalizedInput: string, config: MCPServerConfig): Record<string, unknown>;
    /** search_issues 以 GitHub 搜索语法查询 */
    buildSearchArgs(query: string): Record<string, unknown>;
    parseDetail(content: unknown): RequirementDetail;
    parseList(content: unknown): Requirement[];
    /** GitHub 不提供附件认证下载（图床公开直连），暂不构建图片服务 */
    createImageService(): undefined;
    /** GitHub issue JSON → 中立需求模型 */
    private mapIssueToDetail;
}
//# sourceMappingURL=github-adapter.d.ts.map