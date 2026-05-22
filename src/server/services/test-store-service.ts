/**
 * @file 测试运行记录存储服务
 * @description 提供测试运行记录的本地持久化存储能力。
 *   每次测试执行（包括手动触发和管线自动执行）的结果都会被保存到本地，
 *   以便用户查看历史记录和追踪测试趋势。
 *   数据以 JSON 数组格式存储在 ~/.ai-dev-workbench/test-runs.json 文件中。
 *   最多保留 50 条记录。
 */
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';
import {JsonStore} from './json-store.js';
import type {TestResults} from './test-executor-service.js';

/**
 * 已持久化的测试运行记录接口
 */
/** 沙箱测试阶段记录 */
export interface TestPhaseRecord {
    /** 阶段标识 */
    phase: 'writing' | 'sandbox_run' | 'fixing' | 'sandbox_rerun';
    /** 阶段显示标签 */
    label: string;
    /** 开始时间 */
    startedAt: string;
    /** 完成时间 */
    completedAt?: string;
    /** 阶段状态 */
    status: 'running' | 'completed' | 'failed' | 'skipped';
}

export interface PersistedTestRun {
    /** 记录唯一标识符 */
    id: string;
    /** 执行状态 */
    status: 'running' | 'completed' | 'failed';
    /** 触发模式 */
    mode: 'manual' | 'pipeline_run_existing' | 'pipeline_ai_generate' | 'manual_ai_generate' | 'manual_ai_generate_e2e';
    /** 使用的测试框架名称 */
    framework?: string;
    /** 工作空间路径 */
    workspacePath: string;
    /** 结构化测试结果 */
    results?: TestResults;
    /** 原始输出 */
    rawOutput?: string;
    /** 错误信息 */
    error?: string;
    /** 关联执行记录 ID */
    executionId?: string;
    /** 关联计划 ID */
    planId?: string;
    /** 关联管线 ID */
    pipelineId?: string;
    /** 开始时间 */
    startedAt: string;
    /** 完成时间 */
    completedAt?: string;
    /** 测试执行环境 */
    environment?: 'local' | 'sandbox';
    /** 使用的沙箱 ID */
    sandboxId?: string;
    /** 当前沙箱测试阶段（仅 sandbox 模式） */
    currentPhase?: TestPhaseRecord['phase'];
    /** 各阶段执行记录（仅 sandbox 模式） */
    phases?: TestPhaseRecord[];
}

/** 默认存储文件路径 */
const TEST_RUNS_FILE = path.join(APP_DATA_DIR, 'test-runs.json');

/**
 * 测试运行记录存储服务类
 *
 * 继承 JsonStore 通用基类，按 startedAt 倒序排列，最多保留 50 条记录。
 */
export class TestStoreService extends JsonStore<PersistedTestRun> {
    constructor(storeFile?: string) {
        super({defaultPath: TEST_RUNS_FILE, maxRecords: 50, sortField: 'startedAt'}, storeFile);
    }
}
