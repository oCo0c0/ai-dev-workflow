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
        // 空壳防御：源侧解析失败可能产出 id 为空的壳记录——存进去会变成
        // 无法打开也无法删除的死条目（空 id 匹配不到任何路由），直接拒绝。
        if (detail.id.trim() === '') {
            throw new Error('需求 id 为空（源侧解析失败），已拒绝保存');
        }
        const existing = this.get(detail.id);
        const saved = {
            ...detail,
            // 既有执行历史必须保留（详情更新不得抹掉执行记录）
            executions: existing?.executions ?? [],
            // 工作副本与解析结果同样跨刷新保留（源 description 更新由 detail 覆盖）
            parsedAttachments: existing?.parsedAttachments,
            workingDescription: existing?.workingDescription,
            workingUpdatedAt: existing?.workingUpdatedAt,
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
    /** 写入一份附件解析结果（按附件名索引） */
    setParsedAttachment(id, name, record) {
        const req = this.get(id);
        if (!req)
            return undefined;
        req.parsedAttachments = { ...(req.parsedAttachments ?? {}), [name]: record };
        this.persist();
        return req;
    }
    /** 保存文档工作副本（编辑 / 合并都走这里） */
    setWorkingDescription(id, description) {
        const req = this.get(id);
        if (!req)
            return undefined;
        req.workingDescription = description;
        req.workingUpdatedAt = new Date().toISOString();
        this.persist();
        return req;
    }
    /** 放弃工作副本，回到源描述 */
    clearWorkingDescription(id) {
        const req = this.get(id);
        if (!req)
            return undefined;
        delete req.workingDescription;
        delete req.workingUpdatedAt;
        this.persist();
        return req;
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
    /**
     * 删除一份附件：移出附件列表 + 清掉它的解析结果 + 从工作副本剥掉它的合并标记块
     * （本地文件保留——描述里的图片引用可能仍指向它）
     */
    removeAttachment(id, name) {
        const req = this.get(id);
        if (!req)
            return undefined;
        const attachments = req.attachments.filter(a => a.name !== name);
        if (attachments.length === req.attachments.length && req.parsedAttachments?.[name] === undefined) {
            return req; // 附件本就不存在
        }
        const parsedAttachments = { ...(req.parsedAttachments ?? {}) };
        delete parsedAttachments[name];
        let workingDescription = req.workingDescription;
        if (workingDescription !== undefined) {
            const { open, close } = parseMarker(name);
            const openIdx = workingDescription.indexOf(open);
            if (openIdx >= 0) {
                const closeIdx = workingDescription.indexOf(close, openIdx);
                if (closeIdx >= 0) {
                    workingDescription = workingDescription.slice(0, openIdx) + workingDescription.slice(closeIdx + close.length);
                    workingDescription = workingDescription.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
                }
            }
            if (!workingDescription.includes('<!--adw-parse:')) {
                workingDescription = workingDescription.replace(/\n*### 附件解析\s*\n*$/g, '');
            }
            workingDescription = workingDescription.trimEnd() + '\n';
        }
        const updated = {
            ...req,
            attachments,
            parsedAttachments,
            ...(workingDescription !== undefined ? { workingDescription } : {}),
        };
        this.data.requirements = this.data.requirements.map(r => (r.id === id ? updated : r));
        this.persist();
        return updated;
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
        // 自动本地化的附件范围：文档中的图片 + Excel 表格（其他格式保持源链接，不下载）
        const downloadableRe = /\.(png|jpe?g|gif|svg|webp|bmp|xlsx|xlsm|xls)$/i;
        // 有效 URL 判定：http(s) 才算（空串与"（ONES Wiki 附件…）"类占位文本都视同无 URL）
        const isHttpUrl = (url) => /^https?:\/\//i.test(url);
        // 文档正文实际引用的图片（[Image: xxx] 标记）——wiki 源会把整页历史图都挂进
        // 附件列表（无 URL 的 hash 资源），只有被文档引用的才下载、才有展示价值
        const referencedNames = new Set();
        for (const match of req.description.matchAll(/\[Image:\s*([^\]]+)\]/g)) {
            const name = match[1].trim();
            if (name !== '')
                referencedNames.add(name);
        }
        // 下载集 = ① 有真实 http URL 且属于图片/Excel 的附件（真实附件，直连/签名下载）
        //        + ② 文档引用的图片标记（wiki hash 资源无 URL，按名走 token 下载）
        const imageResources = new Map();
        for (const att of req.attachments) {
            if (downloadableRe.test(att.name) && (isHttpUrl(att.url) || referencedNames.has(att.name))) {
                imageResources.set(att.name, att.name);
            }
        }
        for (const name of referencedNames) {
            if (!imageResources.has(name))
                imageResources.set(name, name);
        }
        // 记录"原本有真实远程 URL"的附件（供清洗判定：改写为本地 URL 后 http 判定会失效）
        const hadRemoteUrl = new Set(req.attachments.filter(a => isHttpUrl(a.url)).map(a => a.name));
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
                // 120s 总超时：wiki 图片可能几十张（并发下载下仍需余量）
                await withTimeout(imageService.downloadWikiImages(req.id, resources, imgDir), 120_000);
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
        // [Image: filename.png] → 本地 markdown 图片（无文件无有效远程地址时明示未下载，不伪造链接）
        desc = desc.replace(/\[Image:\s*([^\]]+)\]/g, (_match, imageName) => {
            const trimmed = imageName.trim();
            const remoteUrl = req.attachments.find(a => a.name === trimmed)?.url || '';
            if (fs.existsSync(path.join(imgDir, trimmed)))
                return `![${trimmed}](${localUrl(trimmed)})`;
            if (isHttpUrl(remoteUrl))
                return `![${trimmed}](${remoteUrl})`;
            return `[图片未下载：${trimmed}]`;
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
        // 附件 URL 指向本地（图片 + Excel 只要本地有文件就改写，含原本无 URL 的条目）
        for (const att of req.attachments) {
            if (downloadableRe.test(att.name) || att.type.startsWith('image/')) {
                if (fs.existsSync(path.join(imgDir, att.name))) {
                    att.url = localUrl(att.name);
                }
            }
        }
        // === 附件清洗 ===
        // 1) 同名同 URL 去重（源侧可能把同一内嵌图列多遍）；
        // 2) 死条目移除——附件面板就是「解析」的输入清单，只保留真正可用的：
        //    ① 原本有真实远程 URL 的（未本地化时解析端可按 URL 下载）；
        //    ② 已下载到本地且被文档引用的（url 已改写为本地地址）。
        //    无 URL 的 wiki hash 资源若未被文档引用（源侧整页历史图）一律不列。
        const seen = new Set();
        req.attachments = req.attachments.filter(att => {
            const key = `${att.name}\n${att.url}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        req.attachments = req.attachments.filter(att => hadRemoteUrl.has(att.name)
            || (fs.existsSync(path.join(imgDir, att.name))
                && (referencedNames.has(att.name) || req.description.includes(att.name))));
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
                // 自愈：丢弃 id 为空的历史坏记录（无法路由到的死条目）
                const healthy = parsed.requirements.filter(r => typeof r?.id === 'string' && r.id.trim() !== '');
                return { version: 1, requirements: healthy };
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
/** 总体超时包装（图片下载不卡主流程；竞争结束即清理定时器，不滞留事件循环） */
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout])
        .finally(() => { if (timer !== undefined)
        clearTimeout(timer); });
}
// ── 解析结果合并（纯函数，可独立测试） ─────────────────────────────────
/** 合并标记：注释形态，渲染与 agent 侧均不可见；按附件名成对出现 */
export function parseMarker(name) {
    return { open: `<!--adw-parse:${name}-->`, close: `<!--/adw-parse:${name}-->` };
}
/** 构造一份解析结果的合并块 */
function buildBlock(name, record) {
    const { open, close } = parseMarker(name);
    return `${open}\n**【${name} 解析结果】**（${record.backend} · ${record.parsedAt.slice(0, 16).replace('T', ' ')}）\n\n${record.markdown.trim()}\n${close}`;
}
/** 在描述中定位附件引用的行号（图片/链接/[Image: x] 三种形态，按名称与 URL 匹配） */
function findReferenceLine(desc, name) {
    const stem = name.replace(/\.[^.]+$/, '');
    const lines = desc.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 图片或链接形态：名称出现在 URL 或 alt 里
        const refMatch = line.match(/!?\[([^\]]*)\]\(([^)]*)\)/g) ?? [];
        for (const ref of refMatch) {
            const m = ref.match(/!?\[([^\]]*)\]\(([^)]*)\)/);
            if (m === null)
                continue;
            const [, alt, url] = m;
            if (url.includes(name) || url.includes(encodeURIComponent(name)) || alt === name || alt === stem)
                return i;
        }
        // 富文本占位形态：[Image: xxx] / [image]
        if (new RegExp(`^\\[Image:\\s*${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i').test(line.trim()))
            return i;
    }
    return -1;
}
/**
 * 把解析结果合并进文档（幂等）：
 * - 已有该附件的标记块 → 原位替换（重解析更新不重复）
 * - 描述中有该附件引用 → 引用行后插入（图文相邻）
 * - 都没有 → 文末「附件解析」小节追加
 */
export function mergeParsedIntoDescription(description, parsed) {
    let desc = description;
    const appended = [];
    for (const [name, record] of Object.entries(parsed)) {
        if (record.markdown.trim() === '')
            continue;
        const block = buildBlock(name, record);
        const { open, close } = parseMarker(name);
        const openIdx = desc.indexOf(open);
        if (openIdx >= 0) {
            const closeIdx = desc.indexOf(close, openIdx);
            if (closeIdx >= 0) {
                // 原位替换旧块
                desc = desc.slice(0, openIdx) + block + desc.slice(closeIdx + close.length);
                continue;
            }
        }
        const line = findReferenceLine(desc, name);
        if (line >= 0) {
            const lines = desc.split('\n');
            lines.splice(line + 1, 0, '', block);
            desc = lines.join('\n');
        }
        else {
            appended.push(block);
        }
    }
    if (appended.length > 0) {
        const heading = desc.includes('### 附件解析') ? '' : '\n\n### 附件解析\n';
        desc = `${desc.replace(/\s+$/, '')}${heading}${appended.join('\n\n')}\n`;
    }
    return desc;
}
//# sourceMappingURL=store.js.map