"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequirementStoreService = void 0;
/**
 * @file 需求本地存储服务（文件夹结构）
 * @description 每个需求以独立文件夹存储在 ~/.ai-dev-workbench/requirements/{id}/ 下。
 *   文件夹结构：
 *     requirements/{id}/metadata.json  — 结构化元数据（状态、优先级、负责人等）
 *     requirements/{id}/document.md    — 需求描述（Markdown 格式）
 *     requirements/{id}/images/        — 下载的图片资源
 *
 *   同时提供旧版 requirements.json → 文件夹结构的自动迁移。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
const http_utils_js_1 = require("../utils/http-utils.js");
/** 旧版存储文件路径 */
const LEGACY_STORE_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'requirements.json');
/**
 * 需求本地存储服务类
 *
 * 以需求 ID 为键，每个需求独立文件夹存储。
 * metadata.json 存结构化元数据，document.md 存 Markdown 描述。
 */
class RequirementStoreService {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir ?? constants_js_1.REQUIREMENTS_DIR;
    }
    // === 基础目录 ===
    /** 需求文件夹路径 */
    reqDir(id) {
        return path_1.default.join(this.rootDir, id);
    }
    /** metadata.json 路径 */
    metadataPath(id) {
        return path_1.default.join(this.reqDir(id), 'metadata.json');
    }
    /** document.md 路径 */
    documentPath(id) {
        return path_1.default.join(this.reqDir(id), 'document.md');
    }
    // === CRUD ===
    /** 列出所有已保存需求（按 savedAt 倒序） */
    list() {
        if (!fs_1.default.existsSync(this.rootDir))
            return [];
        const entries = [];
        const dirs = fs_1.default.readdirSync(this.rootDir, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            const req = this.readRequirement(dir.name);
            if (req)
                entries.push(req);
        }
        // 按 savedAt 倒序
        return entries.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    }
    /** 根据 ID 获取需求 */
    get(id) {
        return this.readRequirement(id);
    }
    /** 创建或更新需求（自动填充 savedAt） */
    upsert(req) {
        const now = req.savedAt ?? new Date().toISOString();
        const { description, ...meta } = { ...req, savedAt: now };
        // 确保目录存在
        const dir = this.reqDir(req.id);
        fs_1.default.mkdirSync(dir, { recursive: true });
        fs_1.default.mkdirSync(path_1.default.join(dir, 'images'), { recursive: true });
        // 写入元数据和文档
        fs_1.default.writeFileSync(this.metadataPath(req.id), JSON.stringify(meta, null, 2), 'utf-8');
        fs_1.default.writeFileSync(this.documentPath(req.id), description ?? '', 'utf-8');
        return { ...meta, description: description ?? '' };
    }
    /** 根据 ID 删除需求（整个文件夹） */
    delete(id) {
        const dir = this.reqDir(id);
        if (!fs_1.default.existsSync(dir))
            return false;
        fs_1.default.rmSync(dir, { recursive: true, force: true });
        return true;
    }
    // === 内部读取 ===
    /** 从文件夹读取完整需求数据 */
    readRequirement(id) {
        const metaFile = this.metadataPath(id);
        const docFile = this.documentPath(id);
        if (!fs_1.default.existsSync(metaFile))
            return undefined;
        try {
            const meta = JSON.parse(fs_1.default.readFileSync(metaFile, 'utf-8'));
            const description = fs_1.default.existsSync(docFile) ? fs_1.default.readFileSync(docFile, 'utf-8') : '';
            return { ...meta, description };
        }
        catch {
            return undefined;
        }
    }
    // === 图片管理 ===
    /** 获取需求图片存储目录 */
    getImageDir(reqId) {
        return path_1.default.join(this.reqDir(reqId), 'images');
    }
    /** 获取本地图片文件路径，不存在返回 null */
    getImagePath(reqId, filename) {
        const imgDir = this.getImageDir(reqId);
        const filePath = path_1.default.join(imgDir, filename);
        // 路径安全检查
        if (!filePath.startsWith(this.rootDir))
            return null;
        return fs_1.default.existsSync(filePath) ? filePath : null;
    }
    /** 下载需求中的远程图片到本地，替换 URL 为本地路径 */
    async downloadImages(req, onesImageService) {
        const reqId = req.id;
        const imgDir = this.getImageDir(reqId);
        fs_1.default.mkdirSync(imgDir, { recursive: true });
        // 从附件中收集图片资源
        const imageResources = new Map();
        for (const att of req.attachments) {
            if (att.url && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name)) {
                const resourceHash = att.name;
                imageResources.set(att.name, resourceHash);
            }
        }
        // 从 description 中的 [Image: xxx.png] 提取图片资源（补充 Attachments 章节缺失的情况）
        const descImageMatches = req.description.matchAll(/\[Image:\s*([^\]]+)\]/g);
        for (const match of descImageMatches) {
            const imageName = match[1].trim();
            if (!imageResources.has(imageName)) {
                imageResources.set(imageName, imageName);
            }
        }
        // 构建 filename → 附件 URL 映射
        const urlMap = new Map();
        for (const att of req.attachments) {
            if (att.url)
                urlMap.set(att.name, att.url);
        }
        // 策略1（优先）: OnesImageService 通过 wiki content token 批量下载
        if (onesImageService && imageResources.size > 0) {
            try {
                const resources = Array.from(imageResources.entries()).map(([name]) => ({ name, url: urlMap.get(name) }));
                const count = await onesImageService.downloadWikiImages(reqId, resources, imgDir);
                console.log(`[ones-image] Wiki token download: ${count}/${imageResources.size} images`);
            }
            catch (err) {
                console.warn(`[ones-image] Wiki token download failed, falling back: ${err instanceof Error ? err.message : err}`);
            }
        }
        // 策略2（回退）: 逐个下载未成功的图片
        for (const [filename] of imageResources) {
            const localPath = path_1.default.join(imgDir, filename);
            if (fs_1.default.existsSync(localPath))
                continue;
            const directUrl = urlMap.get(filename);
            let downloaded = false;
            // 回退A: 直接下载（无认证）
            if (!downloaded && directUrl) {
                try {
                    await (0, http_utils_js_1.downloadFile)(directUrl, localPath);
                    downloaded = true;
                }
                catch { /* 回退 */ }
            }
            // 回退B: OnesImageService 旧方法
            if (!downloaded && onesImageService) {
                try {
                    const resourceHash = filename.replace(/\.[^.]+$/, '');
                    downloaded = await onesImageService.downloadImage(resourceHash, localPath);
                }
                catch { /* 下载失败不阻塞流程 */ }
            }
        }
        let desc = req.description;
        // 替换 [Image: filename.png] 格式
        desc = desc.replace(/\[Image:\s*([^\]]+)\]/g, (_match, imageName) => {
            const trimmed = imageName.trim();
            const localPath = path_1.default.join(imgDir, trimmed);
            const localUrl = `/api/requirements/images/${reqId}/${trimmed}`;
            const remoteUrl = req.attachments.find(a => a.name === trimmed)?.url || '';
            if (fs_1.default.existsSync(localPath))
                return `![${trimmed}](${localUrl})`;
            if (remoteUrl)
                return `![${trimmed}](${remoteUrl})`;
            return `![${trimmed}](${localUrl})`;
        });
        // 替换 [Embed: drawio] 格式
        desc = desc.replace(/\[Embed:\s*([^\]]+)\]/g, (_match, embedType) => {
            return `> 📎 嵌入内容: ${embedType.trim()}（请在 ONES 中查看）`;
        });
        // 替换 markdown 图片语法中的远程 URL
        desc = desc.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_match, alt, url) => {
            const filename = (0, http_utils_js_1.urlToImageFilename)(url);
            const localPath = path_1.default.join(imgDir, filename);
            if (fs_1.default.existsSync(localPath)) {
                return `![${alt}](/api/requirements/images/${reqId}/${filename})`;
            }
            return `![${alt}](${url})`;
        });
        req.description = desc;
        // 更新附件 URL 指向本地
        for (const att of req.attachments) {
            if (att.url && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(att.name)) {
                const localPath = path_1.default.join(imgDir, att.name);
                if (fs_1.default.existsSync(localPath)) {
                    att.url = `/api/requirements/images/${reqId}/${att.name}`;
                }
            }
        }
    }
    // === 数据迁移 ===
    /**
     * 从旧版 requirements.json 迁移到文件夹结构
     * 迁移成功后旧文件重命名为 .bak
     */
    migrateFromLegacy() {
        if (!fs_1.default.existsSync(LEGACY_STORE_FILE))
            return;
        try {
            const raw = fs_1.default.readFileSync(LEGACY_STORE_FILE, 'utf-8');
            const items = JSON.parse(raw);
            if (!Array.isArray(items))
                return;
            let migrated = 0;
            for (const item of items) {
                if (!item.id)
                    continue;
                // 跳过已存在的需求
                if (fs_1.default.existsSync(this.metadataPath(item.id)))
                    continue;
                this.upsert(item);
                migrated++;
            }
            // 迁移旧图片目录
            this.migrateLegacyImages(items);
            // 重命名旧文件
            fs_1.default.renameSync(LEGACY_STORE_FILE, LEGACY_STORE_FILE + '.bak');
            console.log(`[migration] migrated ${migrated} requirements from legacy format`);
        }
        catch (err) {
            console.warn(`[migration] failed to migrate requirements.json: ${err}`);
        }
    }
    /** 将旧版 requirement-images/{id}/ 下的图片移动到新结构 */
    migrateLegacyImages(items) {
        if (!fs_1.default.existsSync(constants_js_1.LEGACY_IMAGE_DIR))
            return;
        for (const item of items) {
            const legacyDir = path_1.default.join(constants_js_1.LEGACY_IMAGE_DIR, item.id);
            if (!fs_1.default.existsSync(legacyDir))
                continue;
            const newDir = this.getImageDir(item.id);
            if (!fs_1.default.existsSync(newDir))
                fs_1.default.mkdirSync(newDir, { recursive: true });
            // 移动图片文件
            const files = fs_1.default.readdirSync(legacyDir);
            for (const file of files) {
                const src = path_1.default.join(legacyDir, file);
                const dest = path_1.default.join(newDir, file);
                if (!fs_1.default.existsSync(dest)) {
                    fs_1.default.copyFileSync(src, dest);
                }
            }
        }
        // 重命名旧图片目录
        try {
            fs_1.default.renameSync(constants_js_1.LEGACY_IMAGE_DIR, constants_js_1.LEGACY_IMAGE_DIR + '.bak');
        }
        catch { /* 非关键，忽略 */ }
    }
}
exports.RequirementStoreService = RequirementStoreService;
//# sourceMappingURL=requirement-store-service.js.map