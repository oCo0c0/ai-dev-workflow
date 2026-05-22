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
import http from 'http';
import https from 'https';
import {downloadFile as httpDownloadFile} from '../utils/http-utils.js';
import {TIMEOUTS} from '../utils/constants.js';

/** ONES 认证后的会话信息 */
interface OnesSession {
    accessToken: string;
    teamUuid: string;
    orgUuid: string;
    expiresAt: number;
    /** 认证流程中收集的 cookies */
    cookies: string;
}

/** Wiki page 缓存：pageUuid → { refUuid, token } */
interface WikiPageCache {
    refUuid: string;
    token: string;
    expiresAt: number;
}

/** GraphQL 响应中的 wiki page 引用 */
interface WikiPageRef {
    uuid: string;
    title: string;
    errorMessage?: string;
}

/** GraphQL 任务查询响应 */
interface TaskGraphQLResponse {
    data?: {
        task?: {
            relatedWikiPages?: WikiPageRef[];
            description?: string;
        };
    };
}

/** Base64URL 编码 */
function base64Url(buf: Buffer): string {
    return buf.toString('base64url');
}

/**
 * ONES 图片下载服务
 * @description 封装 ONES PKCE 认证和 wiki 图片下载逻辑，session 和 wiki page token 自动缓存复用。
 */
export class OnesImageService {
    private readonly apiBase: string;
    private readonly email: string;
    private readonly password: string;
    private session: OnesSession | null = null;

    /** Wiki page 缓存：wikiPageUuid → { refUuid, token, expiresAt } */
    private readonly wikiPageCache = new Map<string, WikiPageCache>();

    /** GraphQL 查询任务的 relatedWikiPages */
    private static readonly TASK_DETAIL_QUERY = `
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

    constructor(apiBase: string, email: string, password: string) {
        this.apiBase = apiBase;
        this.email = email;
        this.password = password;
    }

    /**
     * 获取认证 session（自动缓存复用）
     */
    private async ensureSession(): Promise<OnesSession> {
        if (this.session && Date.now() < this.session.expiresAt) return this.session;

        const baseUrl = this.apiBase;
        const allCookies: string[] = [];

        // 辅助：收集 response 的 cookies
        const collectCookies = (res: Response) => {
            allCookies.push(...this.getSetCookies(res).map(c => c.split(';')[0]));
        };

        // 1. 获取加密证书
        const certRes = await this.fetch(`${baseUrl}/identity/api/encryption_cert`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: '{}',
        });
        if (!certRes.ok) throw new Error(`ONES: encryption_cert failed: ${certRes.status}`);
        const cert = await certRes.json() as { public_key: string };

        // 2. RSA 加密密码
        const encryptedPassword = crypto.publicEncrypt({
            key: cert.public_key,
            padding: crypto.constants.RSA_PKCS1_PADDING,
        }, Buffer.from(this.password, 'utf-8')).toString('base64');

        // 3. 登录
        const loginRes = await this.fetch(`${baseUrl}/identity/api/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email: this.email, password: encryptedPassword}),
        });
        if (!loginRes.ok) throw new Error(`ONES: Login failed: ${loginRes.status}`);
        collectCookies(loginRes);
        const loginData = await loginRes.json() as {
            org_users: Array<{ region_uuid: string; org_uuid: string; org_user: { org_user_uuid: string } }>;
        };

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
            headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookieHeader()},
            body: authorizeParams.toString(),
            redirect: 'manual',
        });
        collectCookies(authorizeRes);
        const authorizeLocation = authorizeRes.headers.get('location');
        if (!authorizeLocation) throw new Error('ONES: Authorize missing location');
        const authRequestId = new URL(authorizeLocation).searchParams.get('id');
        if (!authRequestId) throw new Error('ONES: Cannot parse auth_request_id');

        // 6. Finalize
        const finalizeRes = await this.fetch(`${baseUrl}/identity/api/auth_request/finalize`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json;charset=UTF-8', 'Cookie': cookieHeader()},
            body: JSON.stringify({
                auth_request_id: authRequestId,
                region_uuid: orgUser.region_uuid,
                org_uuid: orgUser.org_uuid,
                org_user_uuid: orgUser.org_user.org_user_uuid,
            }),
        });
        if (!finalizeRes.ok) throw new Error(`ONES: Finalize failed: ${finalizeRes.status}`);

        // 7. Callback → code
        const callbackRes = await this.fetch(`${baseUrl}/identity/authorize/callback?id=${authRequestId}&lang=zh`, {
            method: 'GET',
            headers: {Cookie: cookieHeader()},
            redirect: 'manual',
        });
        collectCookies(callbackRes);
        const callbackLocation = callbackRes.headers.get('location');
        if (!callbackLocation) throw new Error('ONES: Callback missing location');
        const code = new URL(callbackLocation).searchParams.get('code');
        if (!code) throw new Error('ONES: Cannot parse authorization code');

        // 8. Token exchange
        const tokenRes = await this.fetch(`${baseUrl}/identity/oauth/token`, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookieHeader()},
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: 'ones.v1',
                code,
                code_verifier: codeVerifier,
                redirect_uri: `${baseUrl}/auth/authorize/callback`,
            }).toString(),
        });
        if (!tokenRes.ok) throw new Error(`ONES: Token exchange failed: ${tokenRes.status}`);
        const token = await tokenRes.json() as { access_token: string; expires_in: number };

        // 9. 获取 teamUuid
        const teamsRes = await this.fetch(
            `${baseUrl}/project/api/project/organization/${orgUser.org_uuid}/stamps/data?t=org_my_team`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token.access_token}`,
                    'Content-Type': 'application/json;charset=UTF-8',
                },
                body: JSON.stringify({org_my_team: 0}),
            },
        );
        if (!teamsRes.ok) throw new Error(`ONES: Failed to fetch teams: ${teamsRes.status}`);
        const teamsData = await teamsRes.json() as { org_my_team?: { teams?: Array<{ uuid: string }> } };
        const teams = teamsData.org_my_team?.teams ?? [];
        const teamUuid = teams[0]?.uuid;
        if (!teamUuid) throw new Error('ONES: No teams found');

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
    private async graphql<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
        const session = await this.ensureSession();
        const url = `${this.apiBase}/project/api/project/team/${session.teamUuid}/items/graphql`;
        const res = await this.fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({query, variables}),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`ONES: GraphQL failed (${res.status}): ${text.substring(0, 200)}`);
        }
        return res.json() as Promise<T>;
    }

    // === Wiki Page 缓存 ===

    /**
     * 获取 wiki page 的 ref_uuid 和 token（自动缓存）
     * @param wikiPageUuid - Wiki 页面 UUID
     */
    private async getWikiPageAuth(wikiPageUuid: string): Promise<{ refUuid: string; token: string }> {
        // 检查缓存（token 有效期约 10 分钟）
        const cached = this.wikiPageCache.get(wikiPageUuid);
        if (cached && Date.now() < cached.expiresAt) {
            return {refUuid: cached.refUuid, token: cached.token};
        }

        const session = await this.ensureSession();

        // 1. 获取 page detail → ref_uuid
        const detailUrl = `${this.apiBase}/wiki/api/wiki/team/${session.teamUuid}/page/${wikiPageUuid}/detail`;
        const detailRes = await this.fetch(detailUrl, {
            headers: {Authorization: `Bearer ${session.accessToken}`},
        });
        if (!detailRes.ok) {
            throw new Error(`ONES: Wiki page detail failed (${detailRes.status}) for page ${wikiPageUuid}`);
        }
        const detailData = await detailRes.json() as { ref_uuid?: string };
        const refUuid = detailData.ref_uuid;
        if (!refUuid) {
            throw new Error(`ONES: Wiki page ${wikiPageUuid} has no ref_uuid`);
        }

        // 2. 获取 wiki content → token
        const contentUrl = `${this.apiBase}/wiki/api/wiki/team/${session.teamUuid}/online_page/${wikiPageUuid}/content`;
        const contentRes = await this.fetch(contentUrl, {
            headers: {Authorization: `Bearer ${session.accessToken}`},
        });
        if (!contentRes.ok) {
            throw new Error(`ONES: Wiki page content failed (${contentRes.status}) for page ${wikiPageUuid}`);
        }
        const contentData = await contentRes.json() as { token?: string };
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

        return {refUuid, token};
    }

    // === 图片下载 ===

    /**
     * 通过 GraphQL 查询任务关联的 wiki page UUID 列表
     * @param taskUuid - 任务/需求 UUID
     */
    async getWikiPageUuids(taskUuid: string): Promise<string[]> {
        const result = await this.graphql<TaskGraphQLResponse>(
            OnesImageService.TASK_DETAIL_QUERY,
            {key: `task-${taskUuid}`},
        );
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
    async downloadWikiImage(wikiPageUuid: string, resourceHash: string, destPath: string): Promise<boolean> {
        try {
            const session = await this.ensureSession();
            const {refUuid, token} = await this.getWikiPageAuth(wikiPageUuid);

            // 构建 editor resource URL（带 token 参数）
            const imageUrl = `${this.apiBase}/wiki/api/wiki/editor/${session.teamUuid}/${refUuid}/resources/${encodeURIComponent(resourceHash)}?token=${encodeURIComponent(token)}`;

            await httpDownloadFile(imageUrl, destPath, TIMEOUTS.HTTP_DOWNLOAD, {
                Authorization: `Bearer ${session.accessToken}`,
            });
            return true;
        } catch {
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
    async downloadWikiImages(
        taskUuid: string,
        resources: Array<{ name: string; url?: string }>,
        imgDir: string,
    ): Promise<number> {
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
                if (fs.existsSync(localPath)) {
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
    async downloadImage(resourceUuid: string, destPath: string): Promise<boolean> {
        // 策略1: 项目附件签名 URL
        const signedUrl = await this.getSignedUrl(resourceUuid);
        if (signedUrl) {
            try {
                await this.downloadFile(signedUrl, destPath);
                return true;
            } catch { /* 回退 */
            }
        }

        // 策略2: Wiki 资源 API（Bearer token）
        try {
            const session = await this.ensureSession();
            const wikiUrl = `${this.apiBase}/wiki/api/wiki/team/${session.teamUuid}/resource/${resourceUuid}`;
            await this.downloadWithAuth(wikiUrl, destPath);
            return true;
        } catch { /* 回退 */
        }

        return false;
    }

    /**
     * 通过原始 URL + cookies 下载图片（用于 MCP 返回的附件 URL）
     * @param url - 原始图片 URL
     * @param destPath - 本地保存路径
     * @deprecated 使用 downloadWikiImage 代替
     */
    async downloadFromUrl(url: string, destPath: string): Promise<boolean> {
        // 策略1: 直接下载（无认证）
        try {
            await httpDownloadFile(url, destPath);
            return true;
        } catch { /* 回退 */
        }

        // 策略2: Bearer token
        try {
            const headers = await this.getAuthHeaders();
            await httpDownloadFile(url, destPath, undefined, headers);
            return true;
        } catch { /* 回退 */
        }

        // 策略3: cookies
        try {
            const session = await this.ensureSession();
            await this.downloadWithCookies(url, destPath, session.cookies);
            return true;
        } catch { /* 回退 */
        }

        return false;
    }

    /** 获取认证请求头（自动刷新 session） */
    async getAuthHeaders(): Promise<Record<string, string>> {
        const session = await this.ensureSession();
        return {Authorization: `Bearer ${session.accessToken}`};
    }

    // === 工具方法 ===

    /** 使用 Bearer token + cookies 下载文件 */
    private async downloadWithAuth(url: string, destPath: string): Promise<void> {
        const session = await this.ensureSession();
        const headers: Record<string, string> = {
            Authorization: `Bearer ${session.accessToken}`,
        };
        return this.httpDownloadWithHeaders(url, destPath, headers);
    }

    /** 使用 cookies 下载文件 */
    private downloadWithCookies(url: string, destPath: string, cookies: string): Promise<void> {
        return this.httpDownloadWithHeaders(url, destPath, {Cookie: cookies});
    }

    /** 带自定义 headers 的 HTTP 下载 */
    private httpDownloadWithHeaders(
        url: string,
        destPath: string,
        headers: Record<string, string>,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            client.get(url, {timeout: TIMEOUTS.HTTP_DOWNLOAD, headers}, (res) => {
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
    private async getSignedUrl(resourceUuid: string): Promise<string | null> {
        try {
            const session = await this.ensureSession();
            const url = `${this.apiBase}/project/api/project/team/${session.teamUuid}/res/attachment/${resourceUuid}?op=${encodeURIComponent('imageMogr2/auto-orient')}`;

            const res = await this.fetch(url, {
                headers: {Authorization: `Bearer ${session.accessToken}`},
                redirect: 'manual',
            });
            if (res.status === 302 || res.status === 301) {
                return res.headers.get('location');
            }
            // fallback: follow redirect
            const followRes = await this.fetch(url, {
                headers: {Authorization: `Bearer ${session.accessToken}`},
                redirect: 'follow',
            });
            if (followRes.url && followRes.url !== url) return followRes.url;
            return null;
        } catch {
            return null;
        }
    }

    /** 从 response headers 提取 Set-Cookie */
    private getSetCookies(response: Response): string[] {
        const headers = response.headers;
        if ((headers as any).getSetCookie) return (headers as any).getSetCookie();
        const raw = headers.get('set-cookie');
        return raw ? [raw] : [];
    }

    /** fetch 封装（兼容 Node 18/20） */
    private async fetch(url: string, init?: RequestInit & { redirect?: string }): Promise<Response> {
        return globalThis.fetch(url, init as RequestInit);
    }

    /** 下载文件到本地（无认证） */
    private downloadFile(url: string, destPath: string): Promise<void> {
        return httpDownloadFile(url, destPath, TIMEOUTS.BRIDGE_START);
    }
}
