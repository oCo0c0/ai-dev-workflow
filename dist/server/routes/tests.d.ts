/**
 * @file 测试管理路由模块
 * @module routes/tests
 * @description 提供测试（Tests）相关的 RESTful API 路由，涵盖：
 *              - 三种测试模式分流（运行已有 / AI 生成 / AI E2E）
 *              - 手动触发已有测试用例的运行
 *              - AI 模式：通过 Claude Bridge 分析代码并生成/运行测试
 *              - E2E 模式：AI 生成 Playwright 测试文件，再由 Provider 执行
 *              - 测试框架自动检测（基于项目配置文件识别）
 *              - 项目类型检测（Provider 架构，支持 Node/Java/Python 等）
 *              - 测试运行记录的列表查询、结果查看与删除
 *              - 变更文件定向测试
 *              - 测试运行过程通过 WebSocket 实时广播输出日志
 */
import { Router } from 'express';
import { TestExecutorService } from '../services/test-executor-service.js';
import type { CLIRunnerService } from '../services/cli-runner-service.js';
import type { SkillsService } from '../services/skills-service.js';
import type { MemoryService } from '../services/memory/memory-service.js';
import type { SandboxService } from '../services/sandbox-service.js';
/**
 * 创建测试管理路由
 * @param testExecutorService - 测试执行器服务（必需）
 * @param cliRunnerService - CLI 运行器服务（可选，AI 模式需要）
 * @param skillsService - 技能服务（可选，AI 模式 skill 选择器需要）
 * @param memoryService
 * @param sandboxService
 */
export declare function createTestRoutes(testExecutorService: TestExecutorService, cliRunnerService?: CLIRunnerService, skillsService?: SkillsService, memoryService?: MemoryService, sandboxService?: SandboxService): Router;
//# sourceMappingURL=tests.d.ts.map