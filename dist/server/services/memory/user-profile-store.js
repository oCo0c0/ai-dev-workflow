"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserProfileStore = void 0;
/**
 * @module user-profile-store
 * @description 用户画像持久化存储
 *
 * 存储用户偏好信息（语言、编码风格、框架偏好等），
 * 单例模式（id 始终为 "default"），存储在 ~/.ai-dev-workbench/memory/user-profile.json。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../../utils/constants.js");
const STORE_FILE = path_1.default.join(constants_js_1.MEMORY_DIR, 'user-profile.json');
const DEFAULT_PROFILE = {
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
class UserProfileStore {
    storeFile;
    constructor(storeFile) {
        this.storeFile = storeFile ?? STORE_FILE;
    }
    ensureDir() {
        const dir = path_1.default.dirname(this.storeFile);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
    }
    load() {
        if (!fs_1.default.existsSync(this.storeFile))
            return { ...DEFAULT_PROFILE };
        try {
            const raw = fs_1.default.readFileSync(this.storeFile, 'utf-8');
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_PROFILE, ...parsed };
        }
        catch {
            return { ...DEFAULT_PROFILE };
        }
    }
    save(profile) {
        this.ensureDir();
        fs_1.default.writeFileSync(this.storeFile, JSON.stringify(profile, null, 2), 'utf-8');
    }
    /**
     * 获取用户画像
     */
    get() {
        return this.load();
    }
    /**
     * 更新用户画像（局部更新）
     */
    update(partial) {
        const profile = this.load();
        const updated = {
            ...profile,
            ...partial,
            codingStyle: { ...profile.codingStyle, ...(partial.codingStyle ?? {}) },
            frameworkPreferences: { ...profile.frameworkPreferences, ...(partial.frameworkPreferences ?? {}) },
            preferredPatterns: partial.preferredPatterns ?? profile.preferredPatterns,
            updatedAt: new Date().toISOString(),
        };
        this.save(updated);
        return updated;
    }
    /**
     * 重置用户画像为默认值
     */
    reset() {
        const profile = { ...DEFAULT_PROFILE, updatedAt: new Date().toISOString() };
        this.save(profile);
        return profile;
    }
}
exports.UserProfileStore = UserProfileStore;
//# sourceMappingURL=user-profile-store.js.map