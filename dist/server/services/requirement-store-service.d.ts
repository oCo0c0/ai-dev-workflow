import { OnesImageService } from './ones-image-service.js';
import type { MinerUService } from './mineru-service.js';
/**
 * 已存储的需求信息接口
 */
export interface StoredRequirement {
    id: string;
    number?: string;
    title: string;
    status: string;
    priority: string;
    assignee: string;
    updatedAt: string;
    description: string;
    acceptanceCriteria: string[];
    attachments: {
        name: string;
        url: string;
        type: string;
    }[];
    relatedIssues: {
        id: string;
        title: string;
        status: string;
    }[];
    savedAt: string;
    source: string;
}
/**
 * 需求本地存储服务类
 *
 * 以需求 ID 为键，每个需求独立文件夹存储。
 * metadata.json 存结构化元数据，document.md 存 Markdown 描述。
 */
export declare class RequirementStoreService {
    private readonly rootDir;
    constructor(rootDir?: string);
    /** 需求文件夹路径 */
    private reqDir;
    /** metadata.json 路径 */
    private metadataPath;
    /** document.md 路径 */
    private documentPath;
    /** 列出所有已保存需求（按 savedAt 倒序） */
    list(): StoredRequirement[];
    /** 根据 ID 获取需求 */
    get(id: string): StoredRequirement | undefined;
    /** 创建或更新需求（自动填充 savedAt） */
    upsert(req: Omit<StoredRequirement, 'savedAt'> & {
        savedAt?: string;
    }): StoredRequirement;
    /** 根据 ID 删除需求（整个文件夹） */
    delete(id: string): boolean;
    /** 从文件夹读取完整需求数据 */
    private readRequirement;
    /** 获取需求图片存储目录 */
    getImageDir(reqId: string): string;
    /** 获取本地图片文件路径，不存在返回 null */
    getImagePath(reqId: string, filename: string): string | null;
    /** 下载需求中的远程图片到本地，替换 URL 为本地路径 */
    downloadImages(req: {
        id: string;
        description: string;
        attachments: {
            name: string;
            url: string;
            type: string;
        }[];
    }, onesImageService?: OnesImageService): Promise<void>;
    /** 文档附件扩展名正则 */
    private static readonly DOC_EXTENSIONS;
    /**
     * 下载并解析文档附件（PDF/DOCX/PPTX/XLSX）
     *
     * 遍历附件列表，对文档类型附件：
     * 1. 从远程 URL 下载到本地 documents/ 目录
     * 2. 调用 MinerU 服务解析为 Markdown
     * 3. 返回所有解析结果合并的 Markdown 字符串
     *
     * @param req - 需求数据（需含 id、attachments）
     * @param mineruService - MinerU 解析服务实例
     * @param onesImageService - 可选的 ONES 图片服务（用于认证下载）
     * @returns 合并后的 Markdown 字符串，无文档附件时返回空字符串
     */
    downloadAndParseDocuments(req: {
        id: string;
        attachments: {
            name: string;
            url: string;
            type: string;
        }[];
    }, mineruService: MinerUService, onesImageService?: OnesImageService): Promise<string>;
    /**
     * 从旧版 requirements.json 迁移到文件夹结构
     * 迁移成功后旧文件重命名为 .bak
     */
    migrateFromLegacy(): void;
    /** 将旧版 requirement-images/{id}/ 下的图片移动到新结构 */
    private migrateLegacyImages;
}
//# sourceMappingURL=requirement-store-service.d.ts.map