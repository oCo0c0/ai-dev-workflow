/**
 * @file 需求存储（JSON 单文件 + 原子写）
 * @description dsh-adw 插件的持久化层：已保存需求 + 执行链接记录。
 *   与 adw 本体的文件夹结构存储（requirement-store-service）解耦，
 *   插件场景数据量小、结构扁平，单文件 JSON 足够且便于备份。
 */

import fs from 'fs';
import path from 'path';
import type {AttachmentImageService, RequirementDetail} from './requirement-sources/types.js';
import {downloadFile, urlToImageFilename} from './http-utils.js';

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
}

/** 存储文件结构 */
interface StoreShape {
    version: 1;
    requirements: SavedRequirement[];
}

const EMPTY: StoreShape = {version: 1, requirements: []};

/**
 * 需求存储服务
 * @description 单文件 JSON + 临时文件原子写。构造时读入内存，写操作即时落盘。
 *   非并发安全（插件场景单写者：宿主进程唯一实例）。
 */
export class RequirementStore {
    private readonly file: string;
    private readonly imagesRoot: string;
    private data: StoreShape;

    /**
     * @param dataDir - 数据目录（如 ~/.dsh/dsh-adw），不存在则创建
     * @param fileName - 存储文件名（默认 requirements.json）
     */
    constructor(dataDir: string, fileName = 'requirements.json') {
        fs.mkdirSync(dataDir, {recursive: true});
        this.file = path.join(dataDir, fileName);
        this.imagesRoot = path.join(dataDir, 'images');
        this.data = this.load();
    }

    /** 读取全部已保存需求（时间倒序：最近拉取在前） */
    list(): SavedRequirement[] {
        return [...this.data.requirements]
            .sort((a, b) => b.source.fetchedAt.localeCompare(a.source.fetchedAt));
    }

    /** 按 id 获取 */
    get(id: string): SavedRequirement | undefined {
        return this.data.requirements.find(r => r.id === id);
    }

    /** 插入或更新（保留既有 source/executions，更新详情字段） */
    upsert(detail: RequirementDetail, source: SavedRequirement['source']): SavedRequirement {
        // 空壳防御：源侧解析失败可能产出 id 为空的壳记录——存进去会变成
        // 无法打开也无法删除的死条目（空 id 匹配不到任何路由），直接拒绝。
        if (detail.id.trim() === '') {
            throw new Error('需求 id 为空（源侧解析失败），已拒绝保存');
        }
        const existing = this.get(detail.id);
        const saved: SavedRequirement = {
            ...detail,
            // 既有执行历史必须保留（详情更新不得抹掉执行记录）
            executions: existing?.executions ?? [],
            source,
        };
        if (existing) {
            this.data.requirements = this.data.requirements.map(r => (r.id === detail.id ? saved : r));
        } else {
            this.data.requirements.push(saved);
        }
        this.persist();
        return saved;
    }

    /** 删除；返回是否存在 */
    delete(id: string): boolean {
        const before = this.data.requirements.length;
        this.data.requirements = this.data.requirements.filter(r => r.id !== id);
        if (this.data.requirements.length === before) return false;
        this.persist();
        return true;
    }

    /** 追加一条执行链接 */
    addExecution(id: string, link: ExecutionLink): SavedRequirement | undefined {
        const req = this.get(id);
        if (!req) return undefined;
        req.executions.push(link);
        this.persist();
        return req;
    }

    /** 回写执行结局（幂等：已结束的执行不再变更） */
    settleExecution(id: string, executionId: string, outcome: ExecutionLink['outcome'], error?: string): SavedRequirement | undefined {
        const req = this.get(id);
        if (!req) return undefined;
        const link = req.executions.find(e => e.executionId === executionId);
        if (!link || link.endedAt) return req;
        link.endedAt = new Date().toISOString();
        link.outcome = outcome;
        if (error !== undefined) link.error = error;
        this.persist();
        return req;
    }

    // === 图片管理 ===

    /** 需求图片存储目录 */
    getImageDir(reqId: string): string {
        return path.join(this.imagesRoot, sanitizeSegment(reqId));
    }

    /** 本地图片文件路径；不存在或路径不安全返回 null（供宿主静态路由使用） */
    getImagePath(reqId: string, filename: string): string | null {
        const safeReqId = sanitizeSegment(reqId);
        const safeFilename = sanitizeSegment(filename);
        if (!safeReqId || !safeFilename) return null;
        const filePath = path.join(this.getImageDir(safeReqId), safeFilename);
        if (!filePath.startsWith(this.imagesRoot)) return null;
        return fs.existsSync(filePath) ? filePath : null;
    }

    /**
     * 下载需求中的远程图片到本地，并把描述占位符 / 附件 URL 改写为本地地址
     * @description 与 adw 本体 requirement-store-service.downloadImages 同源的三段策略：
     *   1) 适配器图片服务批量下载（wiki token 等源特定认证）；1.5) 无图片资源时从任务
     *   富文本提取内嵌图；2) 并行直连下载兜底。失败不抛出（图片是增强，不是阻塞项）。
     * @param imageUrlBase - 本地图片 URL 前缀（如 /api/dsh-adw/requirements/<id>/images）
     */
    async downloadImages(
        req: RequirementDetail,
        imageService: AttachmentImageService | undefined,
        imageUrlBase: string,
    ): Promise<void> {
        const imgDir = this.getImageDir(req.id);
        fs.mkdirSync(imgDir, {recursive: true});
        const localUrl = (filename: string): string =>
            `${imageUrlBase}/${encodeURIComponent(filename)}`;

        // 从附件与 [Image: x] 标记收集图片资源
        const imageResources = new Map<string, string>();
        for (const att of req.attachments) {
            if (att.url && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name)) {
                imageResources.set(att.name, att.name);
            }
        }
        for (const match of req.description.matchAll(/\[Image:\s*([^\]]+)\]/g)) {
            const name = match[1].trim();
            if (!imageResources.has(name)) imageResources.set(name, name);
        }
        const urlMap = new Map<string, string>();
        for (const att of req.attachments) {
            if (att.url) urlMap.set(att.name, att.url);
        }

        // 策略 1：适配器批量下载（wiki token 等源特定认证）
        if (imageService && imageResources.size > 0) {
            try {
                const resources = Array.from(imageResources.keys())
                    .map(name => ({name, url: urlMap.get(name)}));
                // 120s 总超时：wiki 图片可能几十张（并发下载下仍需余量）
                await withTimeout(imageService.downloadWikiImages(req.id, resources, imgDir), 120_000);
            } catch (err) {
                console.warn(`[adw-images] batch download failed: ${err instanceof Error ? err.message : err}`);
            }
        }

        // 策略 1.5：MCP 输出无图片资源时，从任务富文本提取内嵌图（[image] 占位符对应）
        let richTextImages: Array<{uuid: string; filename: string; localPath: string}> = [];
        if (imageService && imageResources.size === 0) {
            try {
                richTextImages = await withTimeout(imageService.downloadTaskImages(req.id, imgDir), 30_000);
            } catch (err) {
                console.warn(`[adw-images] rich-text download failed: ${err instanceof Error ? err.message : err}`);
            }
        }

        // 策略 2：并行直连兜底（每文件内回退链串行）
        await Promise.all(Array.from(imageResources.keys()).map(async filename => {
            const dest = path.join(imgDir, filename);
            if (fs.existsSync(dest)) return;
            const directUrl = urlMap.get(filename);
            if (directUrl) {
                try {
                    await downloadFile(directUrl, dest);
                    return;
                } catch { /* 走旧接口 */ }
            }
            if (imageService) {
                try {
                    await imageService.downloadImage(filename.replace(/\.[^.]+$/, ''), dest);
                } catch { /* 失败不阻塞 */ }
            }
        }));

        // === 描述改写 ===
        let desc = req.description;

        // 0.2.0 的 [image] / [Image omitted] 占位符按出现顺序对应富文本图片
        if (richTextImages.length > 0) {
            let imgIdx = 0;
            desc = desc.replace(/\[image(?: omitted)?\]/gi, () => {
                const img = richTextImages[imgIdx++];
                if (!img) return '[图片未下载]';
                if (!req.attachments.some(a => a.name === img.filename)) {
                    const ext = (img.filename.split('.').pop() ?? 'png').toLowerCase();
                    req.attachments.push({
                        name: img.filename,
                        url: localUrl(img.filename),
                        type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`,
                    });
                }
                return `![${img.uuid}](${localUrl(img.filename)})`;
            });
        }

        // [Image: filename.png] → 本地/远程 markdown 图片
        desc = desc.replace(/\[Image:\s*([^\]]+)\]/g, (_match, imageName: string) => {
            const trimmed = imageName.trim();
            const remoteUrl = req.attachments.find(a => a.name === trimmed)?.url || '';
            if (fs.existsSync(path.join(imgDir, trimmed))) return `![${trimmed}](${localUrl(trimmed)})`;
            if (remoteUrl) return `![${trimmed}](${remoteUrl})`;
            return `![${trimmed}](${localUrl(trimmed)})`;
        });

        // [Embed: drawio] 等嵌入物提示
        desc = desc.replace(/\[Embed:\s*([^\]]+)\]/g, (_m, embedType: string) =>
            `> 📎 嵌入内容: ${embedType.trim()}（请在源系统中查看）`);

        // markdown 远程图片 URL 已下载则改本地
        desc = desc.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_m, alt: string, url: string) => {
            const filename = urlToImageFilename(url);
            if (fs.existsSync(path.join(imgDir, filename))) {
                return `![${alt}](${localUrl(filename)})`;
            }
            return `![${alt}](${url})`;
        });
        req.description = desc;

        // 附件图片 URL 指向本地（图片型只要本地有文件就改写，含原本无 URL 的条目）
        for (const att of req.attachments) {
            if (/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name) || att.type.startsWith('image/')) {
                if (fs.existsSync(path.join(imgDir, att.name))) {
                    att.url = localUrl(att.name);
                }
            }
        }

        // === 附件清洗 ===
        // 1) 同名同址去重（源侧可能把同一内嵌图列多遍）；
        // 2) 图片型死条目移除：URL 为空（源侧「URL omitted」）且本地也没有文件的，
        //    既不能展示也不能解析，留着只会误导。
        const seen = new Set<string>();
        req.attachments = req.attachments.filter(att => {
            const key = `${att.name}\n${att.url}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        req.attachments = req.attachments.filter(att => {
            const looksImage = /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name) || att.type.startsWith('image/');
            if (!looksImage) return true;
            if (att.url !== '') return true;
            return fs.existsSync(path.join(imgDir, att.name));
        });
    }

    /** 落盘（写临时文件后 rename，原子替换） */
    private persist(): void {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
    }

    /** 读入（损坏/不存在时回空存储；损坏文件另存 .bak 便于排查） */
    private load(): StoreShape {
        try {
            const raw = fs.readFileSync(this.file, 'utf8');
            const parsed = JSON.parse(raw) as StoreShape;
            if (parsed && Array.isArray(parsed.requirements)) {
                // 自愈：丢弃 id 为空的历史坏记录（无法路由到的死条目）
                const healthy = parsed.requirements.filter(r => typeof r?.id === 'string' && r.id.trim() !== '');
                return {version: 1, requirements: healthy};
            }
            return {...EMPTY};
        } catch {
            return {...EMPTY};
        }
    }
}

/** 路径段清洗：去分隔符与遍历片段（防御性，配合 startsWith 双保险） */
function sanitizeSegment(segment: string): string {
    return segment.replace(/[\\/]/g, '-').replace(/\.{2,}/g, '');
}

/** 总体超时包装（图片下载不卡主流程） */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
}
