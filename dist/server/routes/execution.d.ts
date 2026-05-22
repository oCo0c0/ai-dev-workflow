/**
 * @file 执行管理路由模块
 * @module routes/execution
 * @description 提供执行（Execution）相关的 RESTful API 路由，涵盖：
 *              - 基于开发计划启动代码执行（通过 Claude CLI 桥接）
 *              - 执行过程的暂停、中止、重试当前步骤、跳过当前步骤
 *              - 执行状态查看与日志获取
 *              - 执行过程中的多轮对话回复支持
 *              - 执行完成后自动触发测试阶段（根据 Pipeline 配置）
 *              - 执行数据同时存储在内存（活跃执行）和文件持久化层
 */
import { Router } from 'express';
import { CLIRunnerService } from '../services/cli-runner-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { TestExecutorService } from '../services/test-executor-service.js';
import type { MemoryService } from '../services/memory/memory-service.js';
import type { SandboxService } from '../services/sandbox-service.js';
/**
 * 创建执行管理路由
 * @param cliRunnerService - CLI 运行器服务实例，用于调用 Claude CLI 执行代码
 * @param pipelineService - 可选的流水线服务实例，用于解析执行阶段的技能和测试配置
 * @param testExecutorService - 可选的测试执行器服务实例，用于执行完成后自动运行测试
 * @param memoryService
 * @param sandboxService
 * @returns 配置好的 Express Router 实例
 *
 * @example
 * ```ts
 * const router = createExecutionRoutes(cliRunner, pipelineService, testExecutor);
 * app.use('/api/execution', router);
 * ```
 */
export declare function createExecutionRoutes(cliRunnerService: CLIRunnerService, pipelineService?: PipelineService, testExecutorService?: TestExecutorService, memoryService?: MemoryService, sandboxService?: SandboxService): Router;
//# sourceMappingURL=execution.d.ts.map