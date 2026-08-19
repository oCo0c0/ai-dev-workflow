/**
 * @module requirement-sources/ones-adapter
 * @description ONES 需求源适配器
 *
 * 封装 ONES 平台的源特定知识：
 * - 输入方言：ONES wiki/issue 链接、需求号（302 / #302）、issue key（CWXT-129686）
 * - MCP 工具命名：ones-api 的 get_work_item / get_requirement / search_requirements
 * - Markdown 响应章节：Requirement Documents / Untrusted ONES Description 等
 * - 附件认证：ONES PKCE（OnesImageService，凭 MCP env 中的账号密码构建）
 */
import type { MCPServerConfig } from '../mcp-config.js';
import type { AttachmentImageService, RequirementSourceAdapter, RequirementDetail, Requirement, ToolCapability } from './types.js';
/**
 * ONES 需求源适配器
 */
export declare class OnesAdapter implements RequirementSourceAdapter {
    readonly id = "ones";
    readonly label = "ONES";
    readonly description = "ONES \u7814\u53D1\u7BA1\u7406\u5E73\u53F0\uFF1A\u6309\u9700\u6C42\u53F7 / issue key / wiki \u94FE\u63A5\u62C9\u53D6\u9700\u6C42\u8BE6\u60C5\u3001\u63CF\u8FF0\u4E0E\u9644\u4EF6\u56FE\u7247";
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
            hint: string;
            secret?: undefined;
        } | {
            key: string;
            label: string;
            required: boolean;
            hint?: undefined;
            secret?: undefined;
        } | {
            key: string;
            label: string;
            required: boolean;
            secret: boolean;
            hint?: undefined;
        })[];
        instructions: string;
    };
    /**
     * 认领 ONES 系 MCP server 配置
     * @description 认领信号（任一命中）：
     *   - 服务器名含 "ones"（ones-api / ones-mcp 等，用户命名即意图）
     *   - 命令/参数含 "ones"（ones-mcp 类包名直装）
     *   - 命令/参数含 "ai-dev-requirements"（ones-api server 的实际启动包名）
     */
    matchServer(config: MCPServerConfig): boolean;
    /**
     * 规整用户输入
     *
     * ONES 链接直接透传给 get_work_item：需求号可能跨项目重复，链接含 team 标识可唯一定位。
     * 非链接输入：#number 去前缀；issue key（CWXT-129686）取数字部分（key 直拉会 404）。
     *
     * 支持的输入形态：
     *  - ONES 链接（wiki / issue / task）：原样透传
     *  - 纯数字 / #number：`302`、`#302`
     *  - issue key：`CWXT-129686` → `129686`
     *  - uuid / 其它：原样返回
     */
    normalizeInput(raw: string): string;
    /** 纯数字编号（跨项目可能重复，需先搜索解析真实 ID） */
    extractPlainNumber(normalized: string): string | undefined;
    /** ONES 工具以 id 参数定位需求 */
    buildDetailArgs(normalizedInput: string): Record<string, unknown>;
    /** ONES 搜索以 query 参数执行 */
    buildSearchArgs(query: string): Record<string, unknown>;
    parseDetail(content: unknown): RequirementDetail;
    parseList(content: unknown): Requirement[];
    /**
     * 从 MCP server 配置的 env 构建 ONES 图片服务
     * @description 需要 ONES_API_BASE / ONES_ACCOUNT / ONES_PASSWORD 三个环境变量
     */
    createImageService(config: MCPServerConfig): AttachmentImageService | undefined;
}
//# sourceMappingURL=ones-adapter.d.ts.map