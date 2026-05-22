/**
 * @module user-profile-store
 * @description 用户画像持久化存储
 *
 * 存储用户偏好信息（语言、编码风格、框架偏好等），
 * 单例模式（id 始终为 "default"），存储在 ~/.ai-dev-workbench/memory/user-profile.json。
 */
import fs from 'fs';
import path from 'path';
import {MEMORY_DIR} from '../../utils/constants.js';

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

const STORE_FILE = path.join(MEMORY_DIR, 'user-profile.json');

const DEFAULT_PROFILE: UserProfile = {
    id: 'default',
    language: '',
    codingStyle: {
        indentStyle: null,
        indentSize: null,
        quoteStyle: null,
    },
    preferredPatterns: [],
    frameworkPreferences: {},
    updatedAt: new Date().toISOString(),
};

/**
 * 用户画像存储服务
 */
export class UserProfileStore {
    private storeFile: string;

    constructor(storeFile?: string) {
        this.storeFile = storeFile ?? STORE_FILE;
    }

    private ensureDir(): void {
        const dir = path.dirname(this.storeFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
    }

    private load(): UserProfile {
        if (!fs.existsSync(this.storeFile)) return {...DEFAULT_PROFILE};
        try {
            const raw = fs.readFileSync(this.storeFile, 'utf-8');
            const parsed = JSON.parse(raw);
            return {...DEFAULT_PROFILE, ...parsed};
        } catch {
            return {...DEFAULT_PROFILE};
        }
    }

    private save(profile: UserProfile): void {
        this.ensureDir();
        fs.writeFileSync(this.storeFile, JSON.stringify(profile, null, 2), 'utf-8');
    }

    /**
     * 获取用户画像
     */
    get(): UserProfile {
        return this.load();
    }

    /**
     * 更新用户画像（局部更新）
     */
    update(partial: Partial<Omit<UserProfile, 'id'>>): UserProfile {
        const profile = this.load();
        const updated: UserProfile = {
            ...profile,
            ...partial,
            codingStyle: {...profile.codingStyle, ...(partial.codingStyle ?? {})},
            frameworkPreferences: {...profile.frameworkPreferences, ...(partial.frameworkPreferences ?? {})},
            preferredPatterns: partial.preferredPatterns ?? profile.preferredPatterns,
            updatedAt: new Date().toISOString(),
        };
        this.save(updated);
        return updated;
    }

    /**
     * 重置用户画像为默认值
     */
    reset(): UserProfile {
        const profile = {...DEFAULT_PROFILE, updatedAt: new Date().toISOString()};
        this.save(profile);
        return profile;
    }
}
