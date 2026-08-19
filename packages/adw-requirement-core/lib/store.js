/**
 * @file 需求存储（JSON 单文件 + 原子写）
 * @description dsh-adw 插件的持久化层：已保存需求 + 执行链接记录。
 *   与 adw 本体的文件夹结构存储（requirement-store-service）解耦，
 *   插件场景数据量小、结构扁平，单文件 JSON 足够且便于备份。
 */
import fs from 'fs';
import path from 'path';
import { downloadFile, urlToImageFilename } from './http-utils.js';
const EMPTY = { version: 1, requirements: [] };
/**
 * 需求存储服务
 * @description 单文件 JSON + 临时文件原子写。构造时读入内存，写操作即时落盘。
 *   非并发安全（插件场景单写者：宿主进程唯一实例）。
 */
export class RequirementStore {
    file;
    imagesRoot;
    data;
    /**
     * @param dataDir - 数据目录（如 ~/.dsh/dsh-adw），不存在则创建
     * @param fileName - 存储文件名（默认 requirements.json）
     */
    constructor(dataDir, fileName = 'requirements.json') {
        fs.mkdirSync(dataDir, { recursive: true });
        this.file = path.join(dataDir, fileName);
        this.imagesRoot = path.join(dataDir, 'images');
        this.data = this.load();
    }
    /** 读取全部已保存需求（时间倒序：最近拉取在前） */
    list() {
        return [...this.data.requirements]
            .sort((a, b) => b.source.fetchedAt.localeCompare(a.source.fetchedAt));
    }
    /** 按 id 获取 */
    get(id) {
        return this.data.requirements.find(r => r.id === id);
    }
    /** 插入或更新（保留既有 source/executions，更新详情字段） */
    upsert(detail, source) {
        const existing = this.get(detail.id);
        const saved = {
            ...detail,
            // 既有执行历史必须保留（详情更新不得抹掉执行记录）
            executions: existing?.executions ?? [],
            source,
        };
        if (existing) {
            this.data.requirements = this.data.requirements.map(r => (r.id === detail.id ? saved : r));
        }
        else {
            this.data.requirements.push(saved);
        }
        this.persist();
        return saved;
    }
    /** 删除；返回是否存在 */
    delete(id) {
        const before = this.data.requirements.length;
        this.data.requirements = this.data.requirements.filter(r => r.id !== id);
        if (this.data.requirements.length === before)
            return false;
        this.persist();
        return true;
    }
    /** 追加一条执行链接 */
    addExecution(id, link) {
        const req = this.get(id);
        if (!req)
            return undefined;
        req.executions.push(link);
        this.persist();
        return req;
    }
    /** 回写执行结局（幂等：已结束的执行不再变更） */
    settleExecution(id, executionId, outcome, error) {
        const req = this.get(id);
        if (!req)
            return undefined;
        const link = req.executions.find(e => e.executionId === executionId);
        if (!link || link.endedAt)
            return req;
        link.endedAt = new Date().toISOString();
        link.outcome = outcome;
        if (error !== undefined)
            link.error = error;
        this.persist();
        return req;
    }
    // === 图片管理 ===
    /** 需求图片存储目录 */
    getImageDir(reqId) {
        return path.join(this.imagesRoot, sanitizeSegment(reqId));
    }
    /** 本地图片文件路径；不存在或路径不安全返回 null（供宿主静态路由使用） */
    getImagePath(reqId, filename) {
        const safeReqId = sanitizeSegment(reqId);
        const safeFilename = sanitizeSegment(filename);
        if (!safeReqId || !safeFilename)
            return null;
        const filePath = path.join(this.getImageDir(safeReqId), safeFilename);
        if (!filePath.startsWith(this.imagesRoot))
            return null;
        return fs.existsSync(filePath) ? filePath : null;
    }
    /**
     * 下载需求中的远程图片到本地，并把描述占位符 / 附件 URL 改写为本地地址
     * @description 与 adw 本体 requirement-store-service.downloadImages 同源的三段策略：
     *   1) 适配器图片服务批量下载（wiki token 等源特定认证）；1.5) 无图片资源时从任务
     *   富文本提取内嵌图；2) 并行直连下载兜底。失败不抛出（图片是增强，不是阻塞项）。
     * @param imageUrlBase - 本地图片 URL 前缀（如 /api/dsh-adw/requirements/<id>/images）
     */
    async downloadImages(req, imageService, imageUrlBase) {
        const imgDir = this.getImageDir(req.id);
        fs.mkdirSync(imgDir, { recursive: true });
        const localUrl = (filename) => `${imageUrlBase}/${encodeURIComponent(filename)}`;
        // 从附件与 [Image: x] 标记收集图片资源
        const imageResources = new Map();
        for (const att of req.attachments) {
            if (att.url && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name)) {
                imageResources.set(att.name, att.name);
            }
        }
        for (const match of req.description.matchAll(/\[Image:\s*([^\]]+)\]/g)) {
            const name = match[1].trim();
            if (!imageResources.has(name))
                imageResources.set(name, name);
        }
        const urlMap = new Map();
        for (const att of req.attachments) {
            if (att.url)
                urlMap.set(att.name, att.url);
        }
        // 策略 1：适配器批量下载（wiki token 等源特定认证）
        if (imageService && imageResources.size > 0) {
            try {
                const resources = Array.from(imageResources.keys())
                    .map(name => ({ name, url: urlMap.get(name) }));
                await withTimeout(imageService.downloadWikiImages(req.id, resources, imgDir), 30_000);
            }
            catch (err) {
                console.warn(`[adw-images] batch download failed: ${err instanceof Error ? err.message : err}`);
            }
        }
        // 策略 1.5：MCP 输出无图片资源时，从任务富文本提取内嵌图（[image] 占位符对应）
        let richTextImages = [];
        if (imageService && imageResources.size === 0) {
            try {
                richTextImages = await withTimeout(imageService.downloadTaskImages(req.id, imgDir), 30_000);
            }
            catch (err) {
                console.warn(`[adw-images] rich-text download failed: ${err instanceof Error ? err.message : err}`);
            }
        }
        // 策略 2：并行直连兜底（每文件内回退链串行）
        await Promise.all(Array.from(imageResources.keys()).map(async (filename) => {
            const dest = path.join(imgDir, filename);
            if (fs.existsSync(dest))
                return;
            const directUrl = urlMap.get(filename);
            if (directUrl) {
                try {
                    await downloadFile(directUrl, dest);
                    return;
                }
                catch { /* 走旧接口 */ }
            }
            if (imageService) {
                try {
                    await imageService.downloadImage(filename.replace(/\.[^.]+$/, ''), dest);
                }
                catch { /* 失败不阻塞 */ }
            }
        }));
        // === 描述改写 ===
        let desc = req.description;
        // 0.2.0 的 [image] / [Image omitted] 占位符按出现顺序对应富文本图片
        if (richTextImages.length > 0) {
            let imgIdx = 0;
            desc = desc.replace(/\[image(?: omitted)?\]/gi, () => {
                const img = richTextImages[imgIdx++];
                if (!img)
                    return '[图片未下载]';
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
        desc = desc.replace(/\[Image:\s*([^\]]+)\]/g, (_match, imageName) => {
            const trimmed = imageName.trim();
            const remoteUrl = req.attachments.find(a => a.name === trimmed)?.url || '';
            if (fs.existsSync(path.join(imgDir, trimmed)))
                return `![${trimmed}](${localUrl(trimmed)})`;
            if (remoteUrl)
                return `![${trimmed}](${remoteUrl})`;
            return `![${trimmed}](${localUrl(trimmed)})`;
        });
        // [Embed: drawio] 等嵌入物提示
        desc = desc.replace(/\[Embed:\s*([^\]]+)\]/g, (_m, embedType) => `> 📎 嵌入内容: ${embedType.trim()}（请在源系统中查看）`);
        // markdown 远程图片 URL 已下载则改本地
        desc = desc.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_m, alt, url) => {
            const filename = urlToImageFilename(url);
            if (fs.existsSync(path.join(imgDir, filename))) {
                return `![${alt}](${localUrl(filename)})`;
            }
            return `![${alt}](${url})`;
        });
        req.description = desc;
        // 附件图片 URL 指向本地
        for (const att of req.attachments) {
            if (att.url && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name)) {
                if (fs.existsSync(path.join(imgDir, att.name))) {
                    att.url = localUrl(att.name);
                }
            }
        }
    }
    /** 落盘（写临时文件后 rename，原子替换） */
    persist() {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
    }
    /** 读入（损坏/不存在时回空存储；损坏文件另存 .bak 便于排查） */
    load() {
        try {
            const raw = fs.readFileSync(this.file, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.requirements)) {
                return { version: 1, requirements: parsed.requirements };
            }
            return { ...EMPTY };
        }
        catch {
            return { ...EMPTY };
        }
    }
}
/** 路径段清洗：去分隔符与遍历片段（防御性，配合 startsWith 双保险） */
function sanitizeSegment(segment) {
    return segment.replace(/[\\/]/g, '-').replace(/\.{2,}/g, '');
}
/** 总体超时包装（图片下载不卡主流程） */
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
}
//# sourceMappingURL=store.js.map