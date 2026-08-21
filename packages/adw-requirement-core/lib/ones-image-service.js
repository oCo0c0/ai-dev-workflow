/**
 * @file ONES 图片下载服务
 * @description 通过 ONES PKCE 认证获取 access_token，然后通过 wiki content API 获取 token，
 *   结合 wiki page detail API 获取 ref_uuid，构建带认证的 editor resource URL 下载图片。
 *
 *   下载流程：
 *   1. GraphQL 查询任务关联的 wiki page UUID
 *   2. REST API 获取 wiki page detail → ref_uuid
 *   3. REST API 获取 wiki page content → token
 *   4. 构建 editor resource URL：/wiki/api/wiki/editor/{team}/{ref_uuid}/resources/{hash}.png?token={token}
 *   5. 下载图片
 *
 *   认证 session 会缓存直到过期。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { downloadFile as httpDownloadFile } from './http-utils.js';
import { TIMEOUTS } from './constants.js';
import { LruCache } from './lru-cache.js';
/** Base64URL 编码 */
function base64Url(buf) {
    return buf.toString('base64url');
}
/**
 * ONES 图片下载服务
 * @description 封装 ONES PKCE 认证和 wiki 图片下载逻辑，session 和 wiki page token 自动缓存复用。
 */
export class OnesImageService {
    apiBase;
    email;
    password;
    session = null;
    /** Wiki page 缓存：wikiPageUuid → { refUuid, token, expiresAt } */
    wikiPageCache = new LruCache(500);
    /** GraphQL 查询任务的 relatedWikiPages */
    static TASK_DETAIL_QUERY = `
        query Task($key: Key) {
            task(key: $key) {
                relatedWikiPages {
                    uuid
                    title
                    errorMessage
                }
            }
        }
    `;
    /** GraphQL 查询任务原始富文本描述（用于提取 <img> 附件 URL） */
    static TASK_RICH_TEXT_QUERY = `
        query Task($key: Key) {
            task(key: $key) {
                description
            }
        }
    `;
    constructor(apiBase, email, password) {
        this.apiBase = apiBase;
        this.email = email;
        this.password = password;
    }
    /**
     * 获取认证 session（自动缓存复用）
     */
    async ensureSession() {
        if (this.session && Date.now() < this.session.expiresAt)
            return this.session;
        const baseUrl = this.apiBase;
        const allCookies = [];
        // 辅助：收集 response 的 cookies
        const collectCookies = (res) => {
            allCookies.push(...this.getSetCookies(res).map(c => c.split(';')[0]));
        };
        // 1. 获取加密证书
        const certRes = await this.fetch(`${baseUrl}/identity/api/encryption_cert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        if (!certRes.ok)
            throw new Error(`ONES: encryption_cert failed: ${certRes.status}`);
        const cert = await certRes.json();
        // 2. RSA 加密密码
        const encryptedPassword = crypto.publicEncrypt({
            key: cert.public_key,
            padding: crypto.constants.RSA_PKCS1_PADDING,
        }, Buffer.from(this.password, 'utf-8')).toString('base64');
        // 3. 登录
        const loginRes = await this.fetch(`${baseUrl}/identity/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: this.email, password: encryptedPassword }),
        });
        if (!loginRes.ok)
            throw new Error(`ONES: Login failed: ${loginRes.status}`);
        collectCookies(loginRes);
        const loginData = await loginRes.json();
        // 4. 选择组织
        const orgUser = loginData.org_users[0];
        const cookieHeader = () => allCookies.join('; ');
        // 5. PKCE authorize
        const codeVerifier = base64Url(crypto.randomBytes(32));
        const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
        const authorizeParams = new URLSearchParams({
            client_id: 'ones.v1',
            scope: `openid offline_access ones:org:${orgUser.region_uuid}:${orgUser.org_uuid}:${orgUser.org_user.org_user_uuid}`,
            response_type: 'code',
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            redirect_uri: `${baseUrl}/auth/authorize/callback`,
            state: `org_uuid=${orgUser.org_uuid}`,
        });
        const authorizeRes = await this.fetch(`${baseUrl}/identity/authorize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookieHeader() },
            body: authorizeParams.toString(),
            redirect: 'manual',
        });
        collectCookies(authorizeRes);
        const authorizeLocation = authorizeRes.headers.get('location');
        if (!authorizeLocation)
            throw new Error('ONES: Authorize missing location');
        // 直接从 authorize 响应中获取 code（ONES 新流程）
        let code = new URL(authorizeLocation).searchParams.get('code');
        if (code) {
            // 新流程：直接返回 code
        }
        else {
            // 兼容旧流程：需要先获取 auth_request_id
            const authRequestId = new URL(authorizeLocation).searchParams.get('id');
            if (!authRequestId) {
                throw new Error('ONES: Cannot parse auth_request_id or code');
            }
            // 6. Finalize
            const finalizeRes = await this.fetch(`${baseUrl}/identity/api/auth_request/finalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cookie': cookieHeader() },
                body: JSON.stringify({
                    auth_request_id: authRequestId,
                    region_uuid: orgUser.region_uuid,
                    org_uuid: orgUser.org_uuid,
                    org_user_uuid: orgUser.org_user.org_user_uuid,
                }),
            });
            if (!finalizeRes.ok)
                throw new Error(`ONES: Finalize failed: ${finalizeRes.status}`);
            // 7. Callback → code
            const callbackRes = await this.fetch(`${baseUrl}/identity/authorize/callback?id=${authRequestId}&lang=zh`, {
                method: 'GET',
                headers: { Cookie: cookieHeader() },
                redirect: 'manual',
            });
            collectCookies(callbackRes);
            const callbackLocation = callbackRes.headers.get('location');
            if (!callbackLocation)
                throw new Error('ONES: Callback missing location');
            const codeFromCallback = new URL(callbackLocation).searchParams.get('code');
            if (!codeFromCallback)
                throw new Error('ONES: Cannot parse authorization code');
            code = codeFromCallback;
        }
        if (!code)
            throw new Error('ONES: No authorization code obtained');
        // 8. Token exchange
        const tokenRes = await this.fetch(`${baseUrl}/identity/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookieHeader() },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: 'ones.v1',
                code,
                code_verifier: codeVerifier,
                redirect_uri: `${baseUrl}/auth/authorize/callback`,
            }).toString(),
        });
        if (!tokenRes.ok)
            throw new Error(`ONES: Token exchange failed: ${tokenRes.status}`);
        const token = await tokenRes.json();
        // 9. 获取 teamUuid
        const teamsRes = await this.fetch(`${baseUrl}/project/api/project/organization/${orgUser.org_uuid}/stamps/data?t=org_my_team`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token.access_token}`,
                'Content-Type': 'application/json;charset=UTF-8',
            },
            body: JSON.stringify({ org_my_team: 0 }),
        });
        if (!teamsRes.ok)
            throw new Error(`ONES: Failed to fetch teams: ${teamsRes.status}`);
        const teamsData = await teamsRes.json();
        const teams = teamsData.org_my_team?.teams ?? [];
        const teamUuid = teams[0]?.uuid;
        if (!teamUuid)
            throw new Error('ONES: No teams found');
        this.session = {
            accessToken: token.access_token,
            teamUuid,
            orgUuid: orgUser.org_uuid,
            expiresAt: Date.now() + (token.expires_in - 60) * 1000,
            cookies: cookieHeader(),
        };
        return this.session;
    }
    // === GraphQL ===
    /** 执行 GraphQL 查询 */
    async graphql(query, variables) {
        const session = await this.ensureSession();
        const url = `${this.apiBase}/project/api/project/team/${session.teamUuid}/items/graphql`;
        const res = await this.fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, variables }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`ONES: GraphQL failed (${res.status}): ${text.substring(0, 200)}`);
        }
        return res.json();
    }
    // === Wiki Page 缓存 ===
    /**
     * 获取 wiki page 的 ref_uuid 和 token（自动缓存）
     * @param wikiPageUuid - Wiki 页面 UUID
     */
    async getWikiPageAuth(wikiPageUuid) {
        // 检查缓存（token 有效期约 10 分钟）
        const cached = this.wikiPageCache.get(wikiPageUuid);
        if (cached && Date.now() < cached.expiresAt) {
            return { refUuid: cached.refUuid, token: cached.token };
        }
        const session = await this.ensureSession();
        // 1. 获取 page detail → ref_uuid
        const detailUrl = `${this.apiBase}/wiki/api/wiki/team/${session.teamUuid}/page/${wikiPageUuid}/detail`;
        const detailRes = await this.fetch(detailUrl, {
            headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!detailRes.ok) {
            throw new Error(`ONES: Wiki page detail failed (${detailRes.status}) for page ${wikiPageUuid}`);
        }
        const detailData = await detailRes.json();
        const refUuid = detailData.ref_uuid;
        if (!refUuid) {
            throw new Error(`ONES: Wiki page ${wikiPageUuid} has no ref_uuid`);
        }
        // 2. 获取 wiki content → token
        const contentUrl = `${this.apiBase}/wiki/api/wiki/team/${session.teamUuid}/online_page/${wikiPageUuid}/content`;
        const contentRes = await this.fetch(contentUrl, {
            headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!contentRes.ok) {
            throw new Error(`ONES: Wiki page content failed (${contentRes.status}) for page ${wikiPageUuid}`);
        }
        const contentData = await contentRes.json();
        const token = contentData.token;
        if (!token) {
            throw new Error(`ONES: Wiki page ${wikiPageUuid} content has no token`);
        }
        // 缓存 8 分钟（token 有效期约 10 分钟，留 2 分钟余量）
        this.wikiPageCache.set(wikiPageUuid, {
            refUuid,
            token,
            expiresAt: Date.now() + 8 * 60 * 1000,
        });
        return { refUuid, token };
    }
    // === 图片下载 ===
    /**
     * 通过 GraphQL 查询任务关联的 wiki page UUID 列表
     * @description 两个来源取并集：
     *   1. GraphQL relatedWikiPages（wiki 挂在任务关联上）
     *   2. 任务描述富文本中的 wiki 页链接（ai-dev-requirements 0.3.1 起对
     *      子需求等条目，wiki 链接只出现在描述正文里，relatedWikiPages 为空）
     * @param taskUuid - 任务/需求 UUID
     */
    async getWikiPageUuids(taskUuid) {
        let uuids = [];
        try {
            const result = await this.graphql(OnesImageService.TASK_DETAIL_QUERY, { key: `task-${taskUuid}` });
            const pages = result.data?.task?.relatedWikiPages ?? [];
            uuids = pages.filter(p => !p.errorMessage).map(p => p.uuid);
        }
        catch {
            // GraphQL 失败不中断：继续尝试富文本提取（downloadWikiImages 有兜底）
        }
        try {
            const rich = await this.graphql(OnesImageService.TASK_RICH_TEXT_QUERY, { key: `task-${taskUuid}` });
            const html = rich.data?.task?.description ?? '';
            for (const match of html.matchAll(/\/wiki\/#\/team\/[^/\s"']+\/space\/[^/\s"']+\/page\/([A-Za-z0-9]+)/g)) {
                if (!uuids.includes(match[1]))
                    uuids.push(match[1]);
            }
        }
        catch { /* 富文本拉取失败不影响已得结果 */ }
        return uuids;
    }
    /**
     * 通过 wiki page UUID 和 resource hash 下载图片
     * @param wikiPageUuid - Wiki 页面 UUID
     * @param resourceHash - 资源 hash（文件名，含扩展名，如 "xxx.png"）
     * @param destPath - 本地保存路径
     */
    async downloadWikiImage(wikiPageUuid, resourceHash, destPath) {
        try {
            const session = await this.ensureSession();
            const { refUuid, token } = await this.getWikiPageAuth(wikiPageUuid);
            // 构建 editor resource URL（带 token 参数）
            const imageUrl = `${this.apiBase}/wiki/api/wiki/editor/${session.teamUuid}/${refUuid}/resources/${encodeURIComponent(resourceHash)}?token=${encodeURIComponent(token)}`;
            await httpDownloadFile(imageUrl, destPath, TIMEOUTS.HTTP_DOWNLOAD, {
                Authorization: `Bearer ${session.accessToken}`,
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 批量下载需求中的 wiki 图片
     * 自动从附件 URL 中提取 team UUID、editor session（ref_uuid）和 resource hash，
     * 通过 wiki content API 获取 token 后下载。
     *
     * @param taskUuid - 任务 UUID（用于 GraphQL 查询关联 wiki page）
     * @param resources - 资源列表，每项包含 { name: hash.png, url: editor resource URL }
     * @param imgDir - 图片保存目录
     * @returns 成功下载的数量
     */
    async downloadWikiImages(taskUuid, resources, imgDir) {
        // 1. 获取关联的 wiki page UUID 列表
        //    - 需求号 / issue 拉取：taskUuid 是任务 UUID，GraphQL 查其 relatedWikiPages
        //    - wiki URL 直拉：taskUuid 本身就是 wiki page UUID，GraphQL 会 403，直接用作 wiki page
        let wikiPageUuids = [];
        try {
            wikiPageUuids = await this.getWikiPageUuids(taskUuid);
        }
        catch {
            // GraphQL 失败（多见于 wiki URL 直拉，taskUuid 实为 wiki page UUID）→ 走 fallback
        }
        if (wikiPageUuids.length === 0) {
            wikiPageUuids = [taskUuid];
        }
        let downloaded = 0;
        const downloadedSet = new Set(); // 记录已成功下载的图片
        // 2. 对每个 wiki page，并发下载图片（4 并发；串行在图片多时会撞上层总超时）
        //    注：同页首波并发可能重复取一次 wiki token（缓存无 in-flight 去重），无害
        const DOWNLOAD_CONCURRENCY = 4;
        for (const wikiPageUuid of wikiPageUuids) {
            const pending = resources.filter(r => !downloadedSet.has(r.name)
                && !fs.existsSync(`${imgDir}/${r.name}`));
            // 已在本地下好的直接计数
            for (const r of resources) {
                if (!downloadedSet.has(r.name) && fs.existsSync(`${imgDir}/${r.name}`)) {
                    downloaded++;
                    downloadedSet.add(r.name);
                }
            }
            let next = 0;
            const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, pending.length) }, async () => {
                while (next < pending.length) {
                    const resource = pending[next++];
                    const success = await this.downloadWikiImage(wikiPageUuid, resource.name, `${imgDir}/${resource.name}`);
                    if (success) {
                        downloaded++;
                        downloadedSet.add(resource.name); // 记录成功下载
                    }
                }
            });
            await Promise.all(workers);
        }
        return downloaded;
    }
    /**
     * 通过 GraphQL 拉取任务原始富文本描述，提取其中 <img> 标签引用的 ONES 附件图片
     * @description 不依赖 MCP 输出格式（0.2.0 将图片降级为 [image] 占位符），
     *   直接从 ONES 拿原始 HTML，图片为 /project/api/project/team/{team}/res/attachment/{uuid}?redirect=true
     * @param taskUuid - 任务/需求 UUID
     * @returns 图片列表 [{ uuid, url }]，按 <img> 出现顺序
     */
    async fetchTaskRichTextImages(taskUuid) {
        try {
            const result = await this.graphql(OnesImageService.TASK_RICH_TEXT_QUERY, { key: `task-${taskUuid}` });
            const html = result.data?.task?.description ?? '';
            const images = [];
            const re = /<img\b[^>]*\bsrc="([^"]+)"/gi;
            let match;
            while ((match = re.exec(html)) !== null) {
                const url = match[1];
                const uuidMatch = url.match(/\/res\/attachment\/([^/?]+)/);
                if (uuidMatch) {
                    images.push({ uuid: uuidMatch[1], url });
                }
            }
            return images;
        }
        catch {
            return [];
        }
    }
    /**
     * 下载任务富文本描述中的全部 <img> 图片到本地目录
     * @param taskUuid - 任务/需求 UUID
     * @param imgDir - 图片保存目录
     * @returns 成功下载的图片列表（含本地文件名/路径），按 <img> 出现顺序
     */
    async downloadTaskImages(taskUuid, imgDir) {
        const images = await this.fetchTaskRichTextImages(taskUuid);
        const results = [];
        for (const img of images) {
            // 已下载过则跳过（按 uuid 前缀匹配任意扩展名）
            const existing = fs.existsSync(imgDir)
                ? fs.readdirSync(imgDir).find(f => f.startsWith(`${img.uuid}.`))
                : undefined;
            if (existing) {
                results.push({ uuid: img.uuid, filename: existing, localPath: path.join(imgDir, existing) });
                continue;
            }
            // 先下载到临时文件，再从签名 URL / content-type / 魔数推断扩展名后重命名
            const tmpPath = path.join(imgDir, `${img.uuid}.tmp`);
            const ext = await this.downloadTaskImage(img.uuid, tmpPath);
            if (!ext)
                continue;
            const filename = `${img.uuid}.${ext}`;
            const localPath = path.join(imgDir, filename);
            fs.renameSync(tmpPath, localPath);
            results.push({ uuid: img.uuid, filename, localPath });
        }
        return results;
    }
    /**
     * 下载单个 ONES 项目附件图片
     * @description 附件 URL（?redirect=true）返回 302 指向带签名 CDN 地址，
     *   先手动请求拿 location（避免把 ONES Bearer 令牌转发给第三方 CDN），
     *   再无认证下载签名地址。
     * @param uuid - 附件资源 UUID
     * @param destPath - 本地保存路径
     * @returns 推断出的文件扩展名（png/jpg/gif/webp/svg/bmp），失败返回 null
     */
    async downloadTaskImage(uuid, destPath) {
        try {
            const session = await this.ensureSession();
            const url = `${this.apiBase}/project/api/project/team/${session.teamUuid}/res/attachment/${encodeURIComponent(uuid)}?redirect=true`;
            const res = await this.fetch(url, {
                headers: { Authorization: `Bearer ${session.accessToken}` },
                redirect: 'manual',
            });
            // 1. 302 → 签名 CDN 地址
            const location = res.headers.get('location');
            if (location) {
                const ext = extFromUrl(location);
                await httpDownloadFile(location, destPath, TIMEOUTS.HTTP_DOWNLOAD);
                return ext;
            }
            // 2. 免签名直出（部分环境/资源直接返回图片内容）
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                if (buf.length > 0) {
                    const ext = extFromContentType(res.headers.get('content-type'))
                        ?? sniffImageExt(buf)
                        ?? 'png';
                    fs.writeFileSync(destPath, buf);
                    return ext;
                }
            }
            return null;
        }
        catch {
            return null;
        }
    }
    /**
     * 下载图片到本地（多策略自动回退）
     * @param resourceUuid - 资源 UUID（hash）
     * @param destPath - 本地保存路径
     * @deprecated 使用 downloadWikiImage 代替
     */
    async downloadImage(resourceUuid, destPath) {
        // 策略1: 项目附件签名 URL
        const signedUrl = await this.getSignedUrl(resourceUuid);
        if (signedUrl) {
            try {
                await this.downloadFile(signedUrl, destPath);
                return true;
            }
            catch { /* 回退 */
            }
        }
        // 策略2: Wiki 资源 API（Bearer token）
        try {
            const session = await this.ensureSession();
            const wikiUrl = `${this.apiBase}/wiki/api/wiki/team/${session.teamUuid}/resource/${resourceUuid}`;
            await this.downloadWithAuth(wikiUrl, destPath);
            return true;
        }
        catch { /* 回退 */
        }
        return false;
    }
    /**
     * 通过原始 URL + cookies 下载图片（用于 MCP 返回的附件 URL）
     * @param url - 原始图片 URL
     * @param destPath - 本地保存路径
     * @deprecated 使用 downloadWikiImage 代替
     */
    async downloadFromUrl(url, destPath) {
        // 策略1: 直接下载（无认证）
        try {
            await httpDownloadFile(url, destPath);
            return true;
        }
        catch { /* 回退 */
        }
        // 策略2: Bearer token
        try {
            const headers = await this.getAuthHeaders();
            await httpDownloadFile(url, destPath, undefined, headers);
            return true;
        }
        catch { /* 回退 */
        }
        // 策略3: cookies
        try {
            const session = await this.ensureSession();
            await this.downloadWithCookies(url, destPath, session.cookies);
            return true;
        }
        catch { /* 回退 */
        }
        return false;
    }
    /** 获取认证请求头（自动刷新 session） */
    async getAuthHeaders() {
        const session = await this.ensureSession();
        return { Authorization: `Bearer ${session.accessToken}` };
    }
    // === 工具方法 ===
    /** 使用 Bearer token + cookies 下载文件 */
    async downloadWithAuth(url, destPath) {
        const session = await this.ensureSession();
        const headers = {
            Authorization: `Bearer ${session.accessToken}`,
        };
        return this.httpDownloadWithHeaders(url, destPath, headers);
    }
    /** 使用 cookies 下载文件 */
    downloadWithCookies(url, destPath, cookies) {
        return this.httpDownloadWithHeaders(url, destPath, { Cookie: cookies });
    }
    /** 带自定义 headers 的 HTTP 下载 */
    httpDownloadWithHeaders(url, destPath, headers) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            client.get(url, { timeout: TIMEOUTS.HTTP_DOWNLOAD, headers }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.httpDownloadWithHeaders(res.headers.location, destPath, headers).then(resolve).catch(reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const stream = fs.createWriteStream(destPath);
                res.pipe(stream);
                stream.on('finish', () => {
                    stream.close();
                    resolve();
                });
                stream.on('error', reject);
            }).on('error', reject);
        });
    }
    /** 通过项目附件 API 获取签名 URL */
    async getSignedUrl(resourceUuid) {
        try {
            const session = await this.ensureSession();
            const url = `${this.apiBase}/project/api/project/team/${session.teamUuid}/res/attachment/${resourceUuid}?op=${encodeURIComponent('imageMogr2/auto-orient')}`;
            const res = await this.fetch(url, {
                headers: { Authorization: `Bearer ${session.accessToken}` },
                redirect: 'manual',
            });
            if (res.status === 302 || res.status === 301) {
                return res.headers.get('location');
            }
            // fallback: follow redirect
            const followRes = await this.fetch(url, {
                headers: { Authorization: `Bearer ${session.accessToken}` },
                redirect: 'follow',
            });
            if (followRes.url && followRes.url !== url)
                return followRes.url;
            return null;
        }
        catch {
            return null;
        }
    }
    /** 从 response headers 提取 Set-Cookie */
    getSetCookies(response) {
        const headers = response.headers;
        if (headers.getSetCookie)
            return headers.getSetCookie();
        const raw = headers.get('set-cookie');
        return raw ? [raw] : [];
    }
    /** fetch 封装（兼容 Node 18/20） */
    async fetch(url, init) {
        return globalThis.fetch(url, init);
    }
    /** 下载文件到本地（无认证） */
    downloadFile(url, destPath) {
        return httpDownloadFile(url, destPath, TIMEOUTS.BRIDGE_START);
    }
}
// === 工具函数 ===
/** 从 URL 推断图片扩展名（签名 CDN 地址通常带扩展名） */
function extFromUrl(url) {
    const m = url.match(/\.(png|jpe?g|gif|webp|svg|bmp)(?:[?#]|$)/i);
    if (!m)
        return 'png';
    return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
}
/** 从 content-type 推断图片扩展名 */
function extFromContentType(contentType) {
    const ct = (contentType ?? '').toLowerCase();
    const map = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/bmp': 'bmp',
    };
    for (const [k, v] of Object.entries(map)) {
        if (ct.includes(k))
            return v;
    }
    return null;
}
/** 从文件魔数（magic bytes）嗅探图片扩展名 */
function sniffImageExt(buf) {
    if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return 'jpg';
    if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GIF8')
        return 'gif';
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
        return 'webp';
    if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d)
        return 'bmp';
    if (buf.length >= 5 && ['<svg', '<?xml'].some(p => buf.toString('latin1', 0, 5).toLowerCase().startsWith(p)))
        return 'svg';
    return null;
}
//# sourceMappingURL=ones-image-service.js.map