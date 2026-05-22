/**
 * 编码风格接口
 */
export interface CodingStyle {
    /** 缩进风格 */
    indentStyle: 'tabs' | 'spaces' | null;
    /** 缩进大小 */
    indentSize: number | null;
    /** 引号风格 */
    quoteStyle: 'single' | 'double' | null;
}
/**
 * 用户画像接口
 */
export interface UserProfile {
    /** 固定为 "default" */
    id: string;
    /** 用户偏好语言 */
    language: string;
    /** 编码风格 */
    codingStyle: CodingStyle;
    /** 用户偏好模式列表 */
    preferredPatterns: string[];
    /** 框架偏好映射 */
    frameworkPreferences: Record<string, string>;
    /** 最后更新时间 */
    updatedAt: string;
}
/**
 * 用户画像存储服务
 */
export declare class UserProfileStore {
    private storeFile;
    constructor(storeFile?: string);
    private ensureDir;
    private load;
    private save;
    /**
     * 获取用户画像
     */
    get(): UserProfile;
    /**
     * 更新用户画像（局部更新）
     */
    update(partial: Partial<Omit<UserProfile, 'id'>>): UserProfile;
    /**
     * 重置用户画像为默认值
     */
    reset(): UserProfile;
}
//# sourceMappingURL=user-profile-store.d.ts.map