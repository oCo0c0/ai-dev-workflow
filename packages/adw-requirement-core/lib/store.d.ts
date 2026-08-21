/**
 * @file 需求存储（JSON 单文件 + 原子写）
 * @description dsh-adw 插件的持久化层：已保存需求 + 执行链接记录。
 *   与 adw 本体的文件夹结构存储（requirement-store-service）解耦，
 *   插件场景数据量小、结构扁平，单文件 JSON 足够且便于备份。
 */
import type { AttachmentImageService, RequirementDetail } from './requirement-sources/types.js';
/** 一次需求开发执行的链接记录（浏览器半回报，宿主落盘） */
export interface ExecutionLink {
    /** 执行记录 id（uuid） */
    executionId: string;
    /** DSH 会话 id（跳转转录用） */
    sessionId: string;
    /** 执行工作区 id */
    workspaceId: string;
    /** agent 预设（未钉为空） */
    mode?: string;
    /** 权限预设（未钉为空） */
    permission?: string;
    /** 实际发出的开发 prompt */
    prompt: string;
    /** 开始时间（ISO 8601） */
    startedAt: string;
    /** 结束时间（ISO 8601，未结束为空） */
    endedAt?: string;
    /** 结局（未结束为空） */
    outcome?: 'succeeded' | 'failed' | 'cancelled';
    /** 失败原因 */
    error?: string;
}
/** 一份附件的 MinerU 解析结果（持久化，随需求走） */
export interface ParsedAttachment {
    /** 解析出的 Markdown 源码 */
    markdown: string;
    /** 所用后端（pipeline / vlm-* …） */
    backend: string;
    /** 解析时间（ISO 8601） */
    parsedAt: string;
}
/** 已保存的需求：详情 + 溯源 + 执行历史 */
export interface SavedRequirement extends RequirementDetail {
    /** 拉取溯源 */
    source: {
        /** 命中的适配器 id（ones / github / generic） */
        adapterId: string;
        /** 拉取所用 MCP server 名 */
        serverName: string;
        /** 原始输入（refresh 复用） */
        input: string;
        /** 拉取时间（ISO 8601） */
        fetchedAt: string;
    };
    /** 执行历史（时间升序） */
    executions: ExecutionLink[];
    /** 附件解析结果，按附件名索引（拉取时不产出，解析动作写入） */
    parsedAttachments?: Record<string, ParsedAttachment>;
    /** 文档工作副本（编辑 + 解析合并写入）；未设置时展示/执行均用源 description */
    workingDescription?: string;
    /** 工作副本最后写入时间（ISO 8601；用于「源已更新」提示） */
    workingUpdatedAt?: string;
}
/**
 * 需求存储服务
 * @description 单文件 JSON + 临时文件原子写。构造时读入内存，写操作即时落盘。
 *   非并发安全（插件场景单写者：宿主进程唯一实例）。
 */
export declare class RequirementStore {
    private readonly file;
    private readonly imagesRoot;
    private data;
    /**
     * @param dataDir - 数据目录（如 ~/.dsh/dsh-adw），不存在则创建
     * @param fileName - 存储文件名（默认 requirements.json）
     */
    constructor(dataDir: string, fileName?: string);
    /** 读取全部已保存需求（时间倒序：最近拉取在前） */
    list(): SavedRequirement[];
    /** 按 id 获取 */
    get(id: string): SavedRequirement | undefined;
    /** 插入或更新（保留既有 source/executions，更新详情字段） */
    upsert(detail: RequirementDetail, source: SavedRequirement['source']): SavedRequirement;
    /** 写入一份附件解析结果（按附件名索引） */
    setParsedAttachment(id: string, name: string, record: ParsedAttachment): SavedRequirement | undefined;
    /** 保存文档工作副本（编辑 / 合并都走这里） */
    setWorkingDescription(id: string, description: string): SavedRequirement | undefined;
    /** 放弃工作副本，回到源描述 */
    clearWorkingDescription(id: string): SavedRequirement | undefined;
    /** 删除；返回是否存在 */
    delete(id: string): boolean;
    /**
     * 删除一份附件：移出附件列表 + 清掉它的解析结果 + 从工作副本剥掉它的合并标记块
     * （本地文件保留——描述里的图片引用可能仍指向它）
     */
    removeAttachment(id: string, name: string): SavedRequirement | undefined;
    /** 追加一条执行链接 */
    addExecution(id: string, link: ExecutionLink): SavedRequirement | undefined;
    /** 回写执行结局（幂等：已结束的执行不再变更） */
    settleExecution(id: string, executionId: string, outcome: ExecutionLink['outcome'], error?: string): SavedRequirement | undefined;
    /** 需求图片存储目录 */
    getImageDir(reqId: string): string;
    /** 本地图片文件路径；不存在或路径不安全返回 null（供宿主静态路由使用） */
    getImagePath(reqId: string, filename: string): string | null;
    /**
     * 下载需求中的远程图片到本地，并把描述占位符 / 附件 URL 改写为本地地址
     * @description 与 adw 本体 requirement-store-service.downloadImages 同源的三段策略：
     *   1) 适配器图片服务批量下载（wiki token 等源特定认证）；1.5) 无图片资源时从任务
     *   富文本提取内嵌图；2) 并行直连下载兜底。失败不抛出（图片是增强，不是阻塞项）。
     * @param imageUrlBase - 本地图片 URL 前缀（如 /api/dsh-adw/requirements/<id>/images）
     */
    downloadImages(req: RequirementDetail, imageService: AttachmentImageService | undefined, imageUrlBase: string): Promise<void>;
    /** 落盘（写临时文件后 rename，原子替换） */
    private persist;
    /** 读入（损坏/不存在时回空存储；损坏文件另存 .bak 便于排查） */
    private load;
}
/** 合并标记：注释形态，渲染与 agent 侧均不可见；按附件名成对出现 */
export declare function parseMarker(name: string): {
    open: string;
    close: string;
};
/**
 * 把解析结果合并进文档（幂等）：
 * - 已有该附件的标记块 → 原位替换（重解析更新不重复）
 * - 描述中有该附件引用 → 引用行后插入（图文相邻）
 * - 都没有 → 文末「附件解析」小节追加
 */
export declare function mergeParsedIntoDescription(description: string, parsed: Record<string, ParsedAttachment>): string;
//# sourceMappingURL=store.d.ts.map