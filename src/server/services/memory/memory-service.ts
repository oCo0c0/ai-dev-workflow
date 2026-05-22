/**
 * @module memory-service
 * @description 记忆系统门面服务
 *
 * 协调用户画像、项目特征、反馈日志三个 store，
 * 提供：自动收集项目特征、构建 prompt 增强上下文、记录执行结果到记忆。
 * 通过 eventBus 订阅 execution:complete 和 test:complete 事件，自动更新记忆。
 */
import fs from 'fs';
import path from 'path';
import {eventBus} from '../../event-bus.js';
import {UserProfileStore, type UserProfile} from './user-profile-store.js';
import {ProjectFactsStore, type ProjectFact} from './project-facts-store.js';
import {FeedbackLogStore, type FeedbackEntry} from './feedback-log-store.js';
import {getErrorMessage} from '../../utils/error-utils.js';

/**
 * execution:complete 事件的数据结构
 */
interface ExecutionCompleteData {
    executionId?: string;
    status?: string;
}

/**
 * test:complete 事件的数据结构
 */
interface TestCompleteData {
    taskId?: string;
    status?: string;
    results?: {
        totalTests?: number;
        passed?: number;
        failed?: number;
        framework?: string;
    };
}

/**
 * 记忆系统门面服务
 */
export class MemoryService {
    private userProfileStore: UserProfileStore;
    private projectFactsStore: ProjectFactsStore;
    private feedbackLogStore: FeedbackLogStore;

    constructor(
        userProfileStore?: UserProfileStore,
        projectFactsStore?: ProjectFactsStore,
        feedbackLogStore?: FeedbackLogStore,
    ) {
        this.userProfileStore = userProfileStore ?? new UserProfileStore();
        this.projectFactsStore = projectFactsStore ?? new ProjectFactsStore();
        this.feedbackLogStore = feedbackLogStore ?? new FeedbackLogStore();

        this.registerListeners();
    }

    /**
     * 注册事件订阅
     */
    private registerListeners(): void {
        eventBus.onEvent('execution:complete', (data: unknown) => this.handleExecutionComplete(data));
        eventBus.onEvent('test:complete', (data: unknown) => this.handleTestComplete(data));
    }

    /**
     * 处理执行完成事件 — 更新框架偏好
     */
    private handleExecutionComplete(data: unknown): void {
        try {
            const payload = data as ExecutionCompleteData;
            if (!payload) return;

            // 成功执行时可以推断框架偏好（后续由 analytics 触发更详细的分析）
            // 目前仅记录，不做复杂推断
        } catch (err) {
            console.error(`[memory] handleExecutionComplete error: ${getErrorMessage(err)}`);
        }
    }

    /**
     * 处理测试完成事件 — 更新测试框架偏好
     */
    private handleTestComplete(data: unknown): void {
        try {
            const payload = data as TestCompleteData;
            if (!payload?.results?.framework) return;

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
        } catch (err) {
            console.error(`[memory] handleTestComplete error: ${getErrorMessage(err)}`);
        }
    }

    /**
     * 自动收集项目特征
     *
     * 读取 package.json、tsconfig.json 等配置文件，推断技术栈、测试框架、目录约定。
     * 首次遇到新 workspace 时调用。
     */
    collectProjectFacts(workspacePath: string): ProjectFact | null {
        try {
            const resolved = path.resolve(workspacePath);
            if (!fs.existsSync(resolved)) return null;

            const techStack: string[] = [];
            const testFrameworks: string[] = [];
            let sourceDir = 'src';
            let testDir = 'tests';
            let buildTool = 'npm';
            const configFiles: string[] = [];

            // 读取 package.json
            const pkgPath = path.join(resolved, 'package.json');
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                    const deps = {...pkg.dependencies, ...pkg.devDependencies};

                    // 技术栈推断
                    if (deps.typescript) techStack.push('typescript');
                    if (deps.react) techStack.push('react');
                    if (deps.vue) techStack.push('vue');
                    if (deps.express) techStack.push('express');
                    if (deps.next) techStack.push('nextjs');
                    if (deps.vite) { techStack.push('vite'); buildTool = 'vite'; }

                    // 测试框架推断
                    if (deps.vitest) testFrameworks.push('vitest');
                    if (deps.jest) testFrameworks.push('jest');
                    if (deps.playwright) testFrameworks.push('playwright');
                    if (deps['@playwright/test']) testFrameworks.push('playwright');
                    if (deps.mocha) testFrameworks.push('mocha');

                    // 目录约定推断
                    if (deps.typescript && fs.existsSync(path.join(resolved, 'tsconfig.json'))) {
                        configFiles.push('tsconfig.json');
                    }
                } catch {
                    // package.json 解析失败，跳过
                }
            }

            // 检测源码目录
            for (const dir of ['src', 'lib', 'app', 'source']) {
                if (fs.existsSync(path.join(resolved, dir))) {
                    sourceDir = dir;
                    break;
                }
            }

            // 检测测试目录
            for (const dir of ['tests', 'test', '__tests__', 'spec', 'e2e']) {
                if (fs.existsSync(path.join(resolved, dir))) {
                    testDir = dir;
                    break;
                }
            }

            // 检测 Python 项目
            if (fs.existsSync(path.join(resolved, 'requirements.txt')) ||
                fs.existsSync(path.join(resolved, 'pyproject.toml'))) {
                techStack.push('python');
                if (fs.existsSync(path.join(resolved, 'pytest.ini'))) testFrameworks.push('pytest');
                buildTool = 'pip';
            }

            // 检测 Java 项目
            if (fs.existsSync(path.join(resolved, 'pom.xml'))) {
                techStack.push('java');
                buildTool = 'maven';
            } else if (fs.existsSync(path.join(resolved, 'build.gradle')) ||
                       fs.existsSync(path.join(resolved, 'build.gradle.kts'))) {
                techStack.push('java');
                buildTool = 'gradle';
            }

            // 检测配置文件
            for (const f of ['vite.config.ts', 'vite.config.js', 'jest.config.ts', 'vitest.config.ts']) {
                if (fs.existsSync(path.join(resolved, f))) configFiles.push(f);
            }

            const now = new Date().toISOString();
            const fact = this.projectFactsStore.upsert({
                workspacePath: resolved,
                techStack: [...new Set(techStack)],
                testFrameworks: [...new Set(testFrameworks)],
                directoryConventions: {sourceDir, testDir, configFiles},
                buildTool,
                inferredAt: now,
                updatedAt: now,
            });

            return fact;
        } catch (err) {
            console.error(`[memory] collectProjectFacts error: ${getErrorMessage(err)}`);
            return null;
        }
    }

    /**
     * 构建给定 workspace 的 prompt 增强上下文
     *
     * 组合用户画像和项目特征，生成结构化的上下文文本。
     * 返回空字符串表示无可用记忆。
     */
    buildContextEnrichment(workspacePath: string): string {
        const parts: string[] = [];

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

    getUserProfile(): UserProfile {
        return this.userProfileStore.get();
    }

    updateUserProfile(partial: Partial<Omit<UserProfile, 'id'>>): UserProfile {
        return this.userProfileStore.update(partial);
    }

    getProjectFacts(workspacePath: string): ProjectFact | undefined {
        return this.projectFactsStore.getByPath(workspacePath);
    }

    getFeedbackLog(limit?: number): FeedbackEntry[] {
        return this.feedbackLogStore.list(limit);
    }

    addFeedback(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry {
        return this.feedbackLogStore.add(entry);
    }

    /** 获取 store 实例（供路由直接使用） */
    get userProfile() { return this.userProfileStore; }
    get projectFacts() { return this.projectFactsStore; }
    get feedbackLog() { return this.feedbackLogStore; }
}
