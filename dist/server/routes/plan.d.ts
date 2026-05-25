/**
 * @file 开发计划管理路由模块
 * @module routes/plan
 * @description 提供开发计划（Plan）相关的 RESTful API 路由，涵盖：
 *              - 基于需求自动生成开发计划（通过 Claude CLI 桥接）
 *              - 计划列表查询、状态查看、内容更新与删除
 *              - 计划生成过程中的多轮对话回复支持
 *              - 计划数据同时存储在内存缓存（快速访问）和文件持久化层（持久存储）
 *              - 支持从 Pipeline 配置中解析计划阶段所需的技能（Skills）
 */
import { Router } from 'express';
import { CLIRunnerService } from '../services/cli-runner-service.js';
import { MCPBridgeService } from '../services/mcp-bridge-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { type PersistedPlan } from '../services/plan-store-service.js';
import type { MemoryService } from '../services/memory/memory-service.js';
import type { MinerUService } from '../services/mineru-service.js';
/**
 * @type {PersistedPlan}
 * @description 向后兼容的类型别名，导出给 execution 路由模块使用。
 *              新代码应直接使用 PersistedPlan 类型。
 */
export type StoredPlan = PersistedPlan;
/**
 * 获取计划内存缓存的引用。
 * 主要供 execution 路由模块访问计划数据。
 */
export declare function getPlanStore(): Map<string, PersistedPlan>;
/**
 * 创建开发计划管理路由
 */
export declare function createPlanRoutes(cliRunnerService: CLIRunnerService, mcpBridgeService: MCPBridgeService, pipelineService?: PipelineService, memoryService?: MemoryService, mineruService?: MinerUService): Router;
//# sourceMappingURL=plan.d.ts.map