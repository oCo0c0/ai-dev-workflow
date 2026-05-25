/**
 * @file Hermes 自进化系统单元测试
 * @description 测试 Event Bus、Memory System、Analytics、Prompt Enrichment 的核心功能。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {eventBus} from '../event-bus.js';
import {UserProfileStore} from './memory/user-profile-store.js';
import {ProjectFactsStore} from './memory/project-facts-store.js';
import {FeedbackLogStore} from './memory/feedback-log-store.js';
import {MemoryService} from './memory/memory-service.js';
import {AnalyticsStoreService} from './analytics-store-service.js';
import {AnalyticsService} from './analytics-service.js';
import {enrichPrompt} from '../utils/prompt-enrichment.js';

// === Event Bus 测试 ===

describe('EventBus', () => {
    beforeEach(() => {
        eventBus.removeAllListeners();
    });

    it('should dispatch typed events to subscribers', () => {
        let received: unknown;
        eventBus.onEvent('test-event', (data) => {
            received = data;
        });
        eventBus.dispatch({type: 'test-event', data: {value: 42}});
        expect(received).toEqual({value: 42});
    });

    it('should dispatch wildcard events', () => {
        const events: string[] = [];
        eventBus.onAny((type) => {
            events.push(type);
        });
        eventBus.dispatch({type: 'event-a', data: null});
        eventBus.dispatch({type: 'event-b', data: null});
        expect(events).toEqual(['event-a', 'event-b']);
    });

    it('should not break on subscriber errors', () => {
        let secondCalled = false;
        eventBus.onEvent('error-test', () => {
            throw new Error('boom');
        });
        eventBus.onEvent('error-test', () => {
            secondCalled = true;
        });
        eventBus.dispatch({type: 'error-test', data: null});
        expect(secondCalled).toBe(true);
    });
});

// === User Profile Store 测试 ===

describe('UserProfileStore', () => {
    let tempDir: string;
    let store: UserProfileStore;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-test-'));
        store = new UserProfileStore(path.join(tempDir, 'user-profile.json'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    it('should return default profile when no file exists', () => {
        const profile = store.get();
        expect(profile.id).toBe('default');
        expect(profile.language).toBe('');
    });

    it('should update partial fields', () => {
        store.update({language: 'zh-CN'});
        const profile = store.get();
        expect(profile.language).toBe('zh-CN');
        expect(profile.updatedAt).toBeTruthy();
    });

    it('should merge codingStyle partially', () => {
        store.update({codingStyle: {indentStyle: 'spaces', indentSize: null, quoteStyle: null}});
        store.update({codingStyle: {indentSize: 4, indentStyle: null, quoteStyle: null}});
        const profile = store.get();
        expect(profile.codingStyle.indentSize).toBe(4);
        // indentStyle 应保留
    });

    it('should persist across instances', () => {
        store.update({language: 'en'});
        const store2 = new UserProfileStore(path.join(tempDir, 'user-profile.json'));
        expect(store2.get().language).toBe('en');
    });
});

// === Project Facts Store 测试 ===

describe('ProjectFactsStore', () => {
    let tempDir: string;
    let store: ProjectFactsStore;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-test-'));
        store = new ProjectFactsStore(path.join(tempDir, 'project-facts.json'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    it('should generate consistent IDs from path', () => {
        const id1 = ProjectFactsStore.idFromPath('/foo/bar');
        const id2 = ProjectFactsStore.idFromPath('/foo/bar');
        expect(id1).toBe(id2);
    });

    it('should upsert and retrieve by path', () => {
        const now = new Date().toISOString();
        store.upsert({
            workspacePath: '/test/project',
            techStack: ['typescript', 'react'],
            testFrameworks: ['vitest'],
            directoryConventions: {sourceDir: 'src', testDir: 'tests', configFiles: []},
            buildTool: 'npm',
            inferredAt: now,
            updatedAt: now,
        });
        const fact = store.getByPath('/test/project');
        expect(fact).toBeTruthy();
        expect(fact!.techStack).toContain('typescript');
    });
});

// === Feedback Log Store 测试 ===

describe('FeedbackLogStore', () => {
    let tempDir: string;
    let store: FeedbackLogStore;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-test-'));
        store = new FeedbackLogStore(path.join(tempDir, 'feedback-log.json'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    it('should add and list entries', () => {
        store.add({
            executionId: 'exec-1',
            workspacePath: '/test',
            phase: 'execution',
            category: 'correction',
            originalOutput: 'bad code',
            userCorrection: 'good code',
        });
        const entries = store.list();
        expect(entries).toHaveLength(1);
        expect(entries[0].executionId).toBe('exec-1');
    });

    it('should query by executionId', () => {
        store.add({
            executionId: 'exec-1', workspacePath: '/test',
            phase: 'plan', category: 'preference',
            originalOutput: '', userCorrection: '',
        });
        store.add({
            executionId: 'exec-2', workspacePath: '/test',
            phase: 'execution', category: 'correction',
            originalOutput: '', userCorrection: '',
        });
        expect(store.getByExecutionId('exec-1')).toHaveLength(1);
    });
});

// === Memory Service 测试 ===

describe('MemoryService', () => {
    let tempDir: string;
    let memoryService: MemoryService;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-test-'));
        const profileStore = new UserProfileStore(path.join(tempDir, 'user-profile.json'));
        const factsStore = new ProjectFactsStore(path.join(tempDir, 'project-facts.json'));
        const feedbackStore = new FeedbackLogStore(path.join(tempDir, 'feedback-log.json'));
        memoryService = new MemoryService(profileStore, factsStore, feedbackStore);
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
        eventBus.removeAllListeners();
    });

    it('should collect project facts from a real directory', () => {
        // 创建模拟项目结构
        const projectDir = path.join(tempDir, 'my-project');
        fs.mkdirSync(path.join(projectDir, 'src'), {recursive: true});
        fs.mkdirSync(path.join(projectDir, 'tests'), {recursive: true});
        fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
            dependencies: {typescript: '^5.0.0', react: '^18.0.0'},
            devDependencies: {vitest: '^1.0.0'},
        }));

        const fact = memoryService.collectProjectFacts(projectDir);
        expect(fact).toBeTruthy();
        expect(fact!.techStack).toContain('typescript');
        expect(fact!.techStack).toContain('react');
        expect(fact!.testFrameworks).toContain('vitest');
        expect(fact!.directoryConventions.sourceDir).toBe('src');
    });

    it('should build context enrichment string', () => {
        memoryService.updateUserProfile({language: 'zh-CN'});
        const enrichment = memoryService.buildContextEnrichment('/some/path');
        expect(enrichment).toContain('zh-CN');
    });

    it('should return empty enrichment when no data', () => {
        const enrichment = memoryService.buildContextEnrichment('/nonexistent/path');
        // 空 profile (language='') 不会生成任何行，返回空字符串
        expect(enrichment).toBe('');
    });
});

// === Analytics Store 测试 ===

describe('AnalyticsStoreService', () => {
    let tempDir: string;
    let store: AnalyticsStoreService;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));
        store = new AnalyticsStoreService(path.join(tempDir, 'analytics.json'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    it('should create and retrieve analytics records', () => {
        const now = new Date().toISOString();
        const record = store.create({
            executionId: 'exec-1',
            workspacePath: '/test',
            phase: 'execution',
            outcome: 'success',
            startedAt: now,
            completedAt: now,
            durationMs: 1000,
            skillsUsed: ['skill-a'],
            retryCount: 0,
        });
        expect(record.id).toBeTruthy();
        expect(store.get(record.id)).toBeTruthy();
    });

    it('should query by workspace', () => {
        const now = new Date().toISOString();
        store.create({
            executionId: 'e1',
            workspacePath: '/a',
            phase: 'execution',
            outcome: 'success',
            startedAt: now,
            completedAt: now,
            durationMs: 0,
            skillsUsed: [],
            retryCount: 0
        });
        store.create({
            executionId: 'e2',
            workspacePath: '/b',
            phase: 'execution',
            outcome: 'failure',
            startedAt: now,
            completedAt: now,
            durationMs: 0,
            skillsUsed: [],
            retryCount: 0
        });
        expect(store.getByWorkspace('/a')).toHaveLength(1);
        expect(store.getByWorkspace('/b')).toHaveLength(1);
    });
});

// === Prompt Enrichment 测试 ===

describe('enrichPrompt', () => {
    it('should return original prompt when memoryService is undefined', () => {
        expect(enrichPrompt('hello', undefined, '/path')).toBe('hello');
    });

    it('should wrap prompt with context when memory exists', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-test-'));
        const profileStore = new UserProfileStore(path.join(tempDir, 'profile.json'));
        const factsStore = new ProjectFactsStore(path.join(tempDir, 'facts.json'));
        const feedbackStore = new FeedbackLogStore(path.join(tempDir, 'feedback.json'));
        const memory = new MemoryService(profileStore, factsStore, feedbackStore);
        memory.updateUserProfile({language: 'zh-CN'});

        const result = enrichPrompt('do something', memory, '/any');
        expect(result).toContain('Learned Context');
        expect(result).toContain('zh-CN');
        expect(result).toContain('do something');

        fs.rmSync(tempDir, {recursive: true, force: true});
    });
});
