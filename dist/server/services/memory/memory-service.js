"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryService = void 0;
/**
 * @module memory-service
 * @description 记忆系统门面服务
 *
 * 协调用户画像、项目特征、反馈日志三个 store，
 * 提供：自动收集项目特征、构建 prompt 增强上下文、记录执行结果到记忆。
 * 通过 eventBus 订阅 execution:complete 和 test:complete 事件，自动更新记忆。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const event_bus_js_1 = require("../../event-bus.js");
const user_profile_store_js_1 = require("./user-profile-store.js");
const project_facts_store_js_1 = require("./project-facts-store.js");
const feedback_log_store_js_1 = require("./feedback-log-store.js");
const error_utils_js_1 = require("../../utils/error-utils.js");
/**
 * 记忆系统门面服务
 */
class MemoryService {
    userProfileStore;
    projectFactsStore;
    feedbackLogStore;
    constructor(userProfileStore, projectFactsStore, feedbackLogStore) {
        this.userProfileStore = userProfileStore ?? new user_profile_store_js_1.UserProfileStore();
        this.projectFactsStore = projectFactsStore ?? new project_facts_store_js_1.ProjectFactsStore();
        this.feedbackLogStore = feedbackLogStore ?? new feedback_log_store_js_1.FeedbackLogStore();
        this.registerListeners();
    }
    /**
     * 注册事件订阅
     */
    registerListeners() {
        event_bus_js_1.eventBus.onEvent('execution:complete', (data) => this.handleExecutionComplete(data));
        event_bus_js_1.eventBus.onEvent('test:complete', (data) => this.handleTestComplete(data));
    }
    /**
     * 处理执行完成事件 — 更新框架偏好
     */
    handleExecutionComplete(data) {
        try {
            const payload = data;
            if (!payload)
                return;
            // 成功执行时可以推断框架偏好（后续由 analytics 触发更详细的分析）
            // 目前仅记录，不做复杂推断
        }
        catch (err) {
            console.error(`[memory] handleExecutionComplete error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
    }
    /**
     * 处理测试完成事件 — 更新测试框架偏好
     */
    handleTestComplete(data) {
        try {
            const payload = data;
            if (!payload?.results?.framework)
                return;
            // 记录成功的测试框架偏好
            const profile = this.userProfileStore.get();
            if (payload.results.framework && payload.status === 'completed') {
                const current = profile.frameworkPreferences?.test;
                if (current !== payload.results.framework) {
                    this.userProfileStore.update({
                        frameworkPreferences: {
                            ...profile.frameworkPreferences,
                            test: payload.results.framework,
                        },
                    });
                }
            }
        }
        catch (err) {
            console.error(`[memory] handleTestComplete error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
    }
    /**
     * 自动收集项目特征
     *
     * 读取 package.json、tsconfig.json 等配置文件，推断技术栈、测试框架、目录约定。
     * 首次遇到新 workspace 时调用。
     */
    collectProjectFacts(workspacePath) {
        try {
            const resolved = path_1.default.resolve(workspacePath);
            if (!fs_1.default.existsSync(resolved))
                return null;
            const techStack = [];
            const testFrameworks = [];
            let sourceDir = 'src';
            let testDir = 'tests';
            let buildTool = 'npm';
            const configFiles = [];
            // 读取 package.json
            const pkgPath = path_1.default.join(resolved, 'package.json');
            if (fs_1.default.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf-8'));
                    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                    // 技术栈推断
                    if (deps.typescript)
                        techStack.push('typescript');
                    if (deps.react)
                        techStack.push('react');
                    if (deps.vue)
                        techStack.push('vue');
                    if (deps.express)
                        techStack.push('express');
                    if (deps.next)
                        techStack.push('nextjs');
                    if (deps.vite) {
                        techStack.push('vite');
                        buildTool = 'vite';
                    }
                    // 测试框架推断
                    if (deps.vitest)
                        testFrameworks.push('vitest');
                    if (deps.jest)
                        testFrameworks.push('jest');
                    if (deps.playwright)
                        testFrameworks.push('playwright');
                    if (deps['@playwright/test'])
                        testFrameworks.push('playwright');
                    if (deps.mocha)
                        testFrameworks.push('mocha');
                    // 目录约定推断
                    if (deps.typescript && fs_1.default.existsSync(path_1.default.join(resolved, 'tsconfig.json'))) {
                        configFiles.push('tsconfig.json');
                    }
                }
                catch {
                    // package.json 解析失败，跳过
                }
            }
            // 检测源码目录
            for (const dir of ['src', 'lib', 'app', 'source']) {
                if (fs_1.default.existsSync(path_1.default.join(resolved, dir))) {
                    sourceDir = dir;
                    break;
                }
            }
            // 检测测试目录
            for (const dir of ['tests', 'test', '__tests__', 'spec', 'e2e']) {
                if (fs_1.default.existsSync(path_1.default.join(resolved, dir))) {
                    testDir = dir;
                    break;
                }
            }
            // 检测 Python 项目
            if (fs_1.default.existsSync(path_1.default.join(resolved, 'requirements.txt')) ||
                fs_1.default.existsSync(path_1.default.join(resolved, 'pyproject.toml'))) {
                techStack.push('python');
                if (fs_1.default.existsSync(path_1.default.join(resolved, 'pytest.ini')))
                    testFrameworks.push('pytest');
                buildTool = 'pip';
            }
            // 检测 Java 项目
            if (fs_1.default.existsSync(path_1.default.join(resolved, 'pom.xml'))) {
                techStack.push('java');
                buildTool = 'maven';
            }
            else if (fs_1.default.existsSync(path_1.default.join(resolved, 'build.gradle')) ||
                fs_1.default.existsSync(path_1.default.join(resolved, 'build.gradle.kts'))) {
                techStack.push('java');
                buildTool = 'gradle';
            }
            // 检测配置文件
            for (const f of ['vite.config.ts', 'vite.config.js', 'jest.config.ts', 'vitest.config.ts']) {
                if (fs_1.default.existsSync(path_1.default.join(resolved, f)))
                    configFiles.push(f);
            }
            const now = new Date().toISOString();
            const fact = this.projectFactsStore.upsert({
                workspacePath: resolved,
                techStack: [...new Set(techStack)],
                testFrameworks: [...new Set(testFrameworks)],
                directoryConventions: { sourceDir, testDir, configFiles },
                buildTool,
                inferredAt: now,
                updatedAt: now,
            });
            return fact;
        }
        catch (err) {
            console.error(`[memory] collectProjectFacts error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            return null;
        }
    }
    /**
     * 构建给定 workspace 的 prompt 增强上下文
     *
     * 组合用户画像和项目特征，生成结构化的上下文文本。
     * 返回空字符串表示无可用记忆。
     */
    buildContextEnrichment(workspacePath) {
        const parts = [];
        const profile = this.userProfileStore.get();
        if (profile.language) {
            parts.push(`- User language: ${profile.language}`);
        }
        if (profile.codingStyle.indentStyle) {
            parts.push(`- Code style: ${profile.codingStyle.indentStyle} indent`);
        }
        if (Object.keys(profile.frameworkPreferences).length > 0) {
            const prefs = Object.entries(profile.frameworkPreferences)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            parts.push(`- Framework preferences: ${prefs}`);
        }
        if (profile.preferredPatterns.length > 0) {
            parts.push(`- Known patterns: ${profile.preferredPatterns.join(', ')}`);
        }
        // 确保项目特征已收集
        let facts = this.projectFactsStore.getByPath(workspacePath);
        if (!facts) {
            facts = this.collectProjectFacts(workspacePath) ?? undefined;
        }
        if (facts) {
            parts.push(`- Tech stack: ${facts.techStack.join(', ')}`);
            if (facts.testFrameworks.length > 0) {
                parts.push(`- Test frameworks: ${facts.testFrameworks.join(', ')}`);
            }
            parts.push(`- Source dir: ${facts.directoryConventions.sourceDir}, Test dir: ${facts.directoryConventions.testDir}`);
            parts.push(`- Build tool: ${facts.buildTool}`);
        }
        return parts.join('\n');
    }
    // === 公开 API ===
    getUserProfile() {
        return this.userProfileStore.get();
    }
    updateUserProfile(partial) {
        return this.userProfileStore.update(partial);
    }
    getProjectFacts(workspacePath) {
        return this.projectFactsStore.getByPath(workspacePath);
    }
    getFeedbackLog(limit) {
        return this.feedbackLogStore.list(limit);
    }
    addFeedback(entry) {
        return this.feedbackLogStore.add(entry);
    }
    /** 获取 store 实例（供路由直接使用） */
    get userProfile() { return this.userProfileStore; }
    get projectFacts() { return this.projectFactsStore; }
    get feedbackLog() { return this.feedbackLogStore; }
}
exports.MemoryService = MemoryService;
//# sourceMappingURL=memory-service.js.map