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
/**
 * ONES 图片下载服务
 * @description 封装 ONES PKCE 认证和 wiki 图片下载逻辑，session 和 wiki page token 自动缓存复用。
 */
export declare class OnesImageService {
    private readonly apiBase;
    private readonly email;
    private readonly password;
    private session;
    /** Wiki page 缓存：wikiPageUuid → { refUuid, token, expiresAt } */
    private readonly wikiPageCache;
    /** GraphQL 查询任务的 relatedWikiPages */
    private static readonly TASK_DETAIL_QUERY;
    constructor(apiBase: string, email: string, password: string);
    /**
     * 获取认证 session（自动缓存复用）
     */
    private ensureSession;
    /** 执行 GraphQL 查询 */
    private graphql;
    /**
     * 获取 wiki page 的 ref_uuid 和 token（自动缓存）
     * @param wikiPageUuid - Wiki 页面 UUID
     */
    private getWikiPageAuth;
    /**
     * 通过 GraphQL 查询任务关联的 wiki page UUID 列表
     * @param taskUuid - 任务/需求 UUID
     */
    getWikiPageUuids(taskUuid: string): Promise<string[]>;
    /**
     * 通过 wiki page UUID 和 resource hash 下载图片
     * @param wikiPageUuid - Wiki 页面 UUID
     * @param resourceHash - 资源 hash（文件名，含扩展名，如 "xxx.png"）
     * @param destPath - 本地保存路径
     */
    downloadWikiImage(wikiPageUuid: string, resourceHash: string, destPath: string): Promise<boolean>;
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
    downloadWikiImages(taskUuid: string, resources: Array<{
        name: string;
        url?: string;
    }>, imgDir: string): Promise<number>;
    /**
     * 下载图片到本地（多策略自动回退）
     * @param resourceUuid - 资源 UUID（hash）
     * @param destPath - 本地保存路径
     * @deprecated 使用 downloadWikiImage 代替
     */
    downloadImage(resourceUuid: string, destPath: string): Promise<boolean>;
    /**
     * 通过原始 URL + cookies 下载图片（用于 MCP 返回的附件 URL）
     * @param url - 原始图片 URL
     * @param destPath - 本地保存路径
     * @deprecated 使用 downloadWikiImage 代替
     */
    downloadFromUrl(url: string, destPath: string): Promise<boolean>;
    /** 获取认证请求头（自动刷新 session） */
    getAuthHeaders(): Promise<Record<string, string>>;
    /** 使用 Bearer token + cookies 下载文件 */
    private downloadWithAuth;
    /** 使用 cookies 下载文件 */
    private downloadWithCookies;
    /** 带自定义 headers 的 HTTP 下载 */
    private httpDownloadWithHeaders;
    /** 通过项目附件 API 获取签名 URL */
    private getSignedUrl;
    /** 从 response headers 提取 Set-Cookie */
    private getSetCookies;
    /** fetch 封装（兼容 Node 18/20） */
    private fetch;
    /** 下载文件到本地（无认证） */
    private downloadFile;
}
//# sourceMappingURL=ones-image-service.d.ts.map