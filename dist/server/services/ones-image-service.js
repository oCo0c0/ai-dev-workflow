"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnesImageService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const http_utils_js_1 = require("../utils/http-utils.js");
const constants_js_1 = require("../utils/constants.js");
/** Base64URL 编码 */
function base64Url(buf) {
    return buf.toString('base64url');
}
/**
 * ONES 图片下载服务
 * @description 封装 ONES PKCE 认证和 wiki 图片下载逻辑，session 和 wiki page token 自动缓存复用。
 */
class OnesImageService {
    apiBase;
    email;
    password;
    session = null;
    /** Wiki page 缓存：wikiPageUuid → { refUuid, token, expiresAt } */
    wikiPageCache = new Map();
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
        const encryptedPassword = crypto_1.default.publicEncrypt({
            key: cert.public_key,
            padding: crypto_1.default.constants.RSA_PKCS1_PADDING,
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
        const codeVerifier = base64Url(crypto_1.default.randomBytes(32));
        const codeChallenge = base64Url(crypto_1.default.createHash('sha256').update(codeVerifier).digest());
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
        const authRequestId = new URL(authorizeLocation).searchParams.get('id');
        if (!authRequestId)
            throw new Error('ONES: Cannot parse auth_request_id');
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
        const code = new URL(callbackLocation).searchParams.get('code');
        if (!code)
            throw new Error('ONES: Cannot parse authorization code');
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
     * @param taskUuid - 任务/需求 UUID
     */
    async getWikiPageUuids(taskUuid) {
        const result = await this.graphql(OnesImageService.TASK_DETAIL_QUERY, { key: `task-${taskUuid}` });
        const pages = result.data?.task?.relatedWikiPages ?? [];
        return pages
            .filter(p => !p.errorMessage)
            .map(p => p.uuid);
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
            await (0, http_utils_js_1.downloadFile)(imageUrl, destPath, constants_js_1.TIMEOUTS.HTTP_DOWNLOAD, {
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
        const wikiPageUuids = await this.getWikiPageUuids(taskUuid);
        if (wikiPageUuids.length === 0) {
            console.warn(`[ones-image] No wiki pages found for task ${taskUuid}`);
            return 0;
        }
        let downloaded = 0;
        // 2. 对每个 wiki page，尝试下载所有图片
        for (const wikiPageUuid of wikiPageUuids) {
            for (const resource of resources) {
                const localPath = `${imgDir}/${resource.name}`;
                if (fs_1.default.existsSync(localPath)) {
                    downloaded++;
                    continue;
                }
                const success = await this.downloadWikiImage(wikiPageUuid, resource.name, localPath);
                if (success) {
                    downloaded++;
                }
            }
        }
        return downloaded;
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
            await (0, http_utils_js_1.downloadFile)(url, destPath);
            return true;
        }
        catch { /* 回退 */
        }
        // 策略2: Bearer token
        try {
            const headers = await this.getAuthHeaders();
            await (0, http_utils_js_1.downloadFile)(url, destPath, undefined, headers);
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
            const client = url.startsWith('https') ? https_1.default : http_1.default;
            client.get(url, { timeout: constants_js_1.TIMEOUTS.HTTP_DOWNLOAD, headers }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.httpDownloadWithHeaders(res.headers.location, destPath, headers).then(resolve).catch(reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const stream = fs_1.default.createWriteStream(destPath);
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
        return (0, http_utils_js_1.downloadFile)(url, destPath, constants_js_1.TIMEOUTS.BRIDGE_START);
    }
}
exports.OnesImageService = OnesImageService;
//# sourceMappingURL=ones-image-service.js.map