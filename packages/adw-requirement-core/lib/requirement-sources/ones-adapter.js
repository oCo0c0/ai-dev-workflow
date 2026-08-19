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
import { OnesImageService } from '../ones-image-service.js';
import { extractContentJson, mapJsonToDetailBase, mapJsonToRequirement, parseMarkdownRequirementDetail, parseMarkdownRequirementList, } from './parsers.js';
/** ONES 工具能力 → 工具名匹配模式（按优先级） */
const CAPABILITY_PATTERNS = {
    // 需求/工作项详情：ones-api 0.1.x 为 get_requirement，0.2.0 起为 get_work_item
    fetchDetail: [
        /^get_work_item$/, // ones-api >= 0.2.0（需求/任务）
        /^get_requirement$/, // ones-api <= 0.1.x
        /^(get|fetch|read)_(?:work_item|workitem|requirement)(?:_detail)?$/, // 未来重命名兜底
    ],
    // 需求搜索：ones-api 全版本均为 search_requirements
    search: [
        /^search_requirements$/,
        /^search_(?:requirement|issues|work_items)$/, // 未来重命名兜底
    ],
};
/** 已知版本的候选工具名（listTools 不可用时的兜底） */
const FALLBACK_TOOL_NAMES = {
    fetchDetail: ['get_work_item', 'get_requirement'],
    search: ['search_requirements'],
};
/**
 * ONES 需求源适配器
 */
export class OnesAdapter {
    id = 'ones';
    label = 'ONES';
    description = 'ONES 研发管理平台：按需求号 / issue key / wiki 链接拉取需求详情、描述与附件图片';
    capabilityPatterns = CAPABILITY_PATTERNS;
    fallbackToolNames = FALLBACK_TOOL_NAMES;
    installTemplate = {
        serverName: 'ones-api',
        command: 'npx',
        args: ['-y', 'ai-dev-requirements@latest'],
        envSpecs: [
            {
                key: 'ONES_API_BASE',
                label: 'ONES 服务地址',
                required: true,
                hint: '如 https://your-host.ones.ai 或 https://1s.oristand.com',
            },
            { key: 'ONES_ACCOUNT', label: '账号（邮箱）', required: true },
            { key: 'ONES_PASSWORD', label: '密码', required: true, secret: true },
        ],
        instructions: '将通过 ai-dev-requirements MCP server 连接你的 ONES 实例（与现有 ones-api 配置同源）。',
    };
    /**
     * 认领 ONES 系 MCP server 配置
     * @description 认领信号（任一命中）：
     *   - 服务器名含 "ones"（ones-api / ones-mcp 等，用户命名即意图）
     *   - 命令/参数含 "ones"（ones-mcp 类包名直装）
     *   - 命令/参数含 "ai-dev-requirements"（ones-api server 的实际启动包名）
     */
    matchServer(config) {
        const name = (config.name ?? '').toLowerCase();
        const cmdline = [config.command, ...(config.args ?? [])].join(' ').toLowerCase();
        return name.includes('ones')
            || cmdline.includes('ones')
            || cmdline.includes('ai-dev-requirements');
    }
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
    normalizeInput(raw) {
        const s = raw.trim();
        // ONES 链接（http(s):// 开头，或含 hash 路由 #/）：直接透传，不截取需求号
        if (/^https?:\/\//i.test(s) || s.includes('#/')) {
            return s;
        }
        // 非链接：#number 去前缀；issue key（PROJECTKEY-NUMBER）取数字部分
        let v = s.replace(/^#/, '');
        const keyNum = v.match(/^[A-Za-z][A-Za-z0-9]*-(\d+)$/);
        if (keyNum)
            return keyNum[1];
        return v;
    }
    /** 纯数字编号（跨项目可能重复，需先搜索解析真实 ID） */
    extractPlainNumber(normalized) {
        return normalized.match(/^(\d+)$/)?.[1];
    }
    /** ONES 工具以 id 参数定位需求 */
    buildDetailArgs(normalizedInput) {
        return { id: normalizedInput };
    }
    /** ONES 搜索以 query 参数执行 */
    buildSearchArgs(query) {
        return { query };
    }
    parseDetail(content) {
        const raw = extractContentJson(content);
        // JSON 对象格式：通用字段映射
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return mapJsonToDetailBase(raw);
        }
        // Markdown 文本格式：ONES 章节表
        if (typeof raw === 'string') {
            return parseMarkdownRequirementDetail(raw, {
                // 优先 ONES 标准文档章节；Description 可能含嵌套元数据故优先级较低
                sectionOrder: [
                    // 0.2.0 起描述章节更名为 Untrusted ONES Description（含安全提示行）
                    'Requirement Documents', 'Untrusted ONES Description', 'Requirement Detail',
                    'Description', '需求详情', '需求文档', '详情', 'Content',
                ],
                // 文档类章节：内容中含二级标题，仅在尾部 Attachments 时停止
                isDocSection: (name) => /Requirement Documents|Requirement Detail|Description|需求文档|需求详情/i.test(name),
                // 移除 0.2.0 在描述开头注入的安全提示行（Security boundary: ...）
                stripNotice: (desc) => desc.replace(/^>\s*Security boundary:[^\n]*\n?/i, '').trim(),
            });
        }
        throw new Error('Invalid requirement detail response');
    }
    parseList(content) {
        const raw = extractContentJson(content);
        if (Array.isArray(raw)) {
            return raw.map((item) => mapJsonToRequirement(item));
        }
        if (typeof raw === 'string') {
            return parseMarkdownRequirementList(raw);
        }
        return [];
    }
    /**
     * 从 MCP server 配置的 env 构建 ONES 图片服务
     * @description 需要 ONES_API_BASE / ONES_ACCOUNT / ONES_PASSWORD 三个环境变量
     */
    createImageService(config) {
        const env = config.env ?? {};
        if (env.ONES_API_BASE && env.ONES_ACCOUNT && env.ONES_PASSWORD) {
            return new OnesImageService(env.ONES_API_BASE, env.ONES_ACCOUNT, env.ONES_PASSWORD);
        }
        return undefined;
    }
}
//# sourceMappingURL=ones-adapter.js.map