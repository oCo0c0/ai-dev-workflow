/**
 * 服务端核心模块
 *
 * 应用服务器工厂函数，负责：
 * 1. 创建 Express 应用并注册全局中间件（CORS、JSON 解析、请求日志）
 * 2. 实例化所有业务服务（MCP配置、MCP桥接、工作区、CLI运行器、测试执行器、技能、流水线、需求存储）
 * 3. 注册所有 API 路由模块（/api/*）
 * 4. 配置静态文件服务和 SPA 回退
 * 5. 创建 HTTP 服务器并初始化 WebSocket
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import {setupWebSocket} from './websocket.js';
import {requestLogger} from './middleware/logger.js';
import {errorHandler} from './middleware/validation.js';

// 服务层
import {MCPConfigService} from './services/mcp-config-service.js';
import {MCPBridgeService} from './services/mcp-bridge-service.js';
import {WorkspaceService} from './services/workspace-service.js';
import {CLIRunnerService} from './services/cli-runner-service.js';
import {TestExecutorService} from './services/test-executor-service.js';
import {SkillsService} from './services/skills-service.js';
import {PipelineService} from './services/pipeline-service.js';
import {RequirementStoreService} from './services/requirement-store-service.js';
import {PlanStoreService} from './services/plan-store-service.js';
import {ExecutionStoreService} from './services/execution-store-service.js';
import {MemoryService} from './services/memory/memory-service.js';
import {AnalyticsStoreService} from './services/analytics-store-service.js';
import {AnalyticsService} from './services/analytics-service.js';
import {SkillDerivationService} from './services/skill-derivation-service.js';
import {SandboxService} from './services/sandbox-service.js';
import {MinerUService} from './services/mineru-service.js';
import {ConfigService} from './services/config-service.js';

// 路由层
import {createRequirementsRoutes} from './routes/requirements.js';
import {createWorkspaceRoutes} from './routes/workspace.js';
import {createPlanRoutes} from './routes/plan.js';
import {createExecutionRoutes} from './routes/execution.js';
import {createTestRoutes} from './routes/tests.js';
import {createSkillsRoutes} from './routes/skills.js';
import {createMCPServersRoutes} from './routes/mcp-servers.js';
import {createPipelineRoutes} from './routes/pipelines.js';
import {createSystemRoutes} from './routes/system.js';
import {createAnalyticsRoutes} from './routes/analytics.js';
import {createMinerURoutes} from './routes/mineru.js';

/**
 * 创建并启动应用服务器
 *
 * 组装完整的 HTTP + WebSocket 服务：
 * - 注册 CORS、JSON 解析、请求日志中间件
 * - 实例化 8 个业务服务并注入路由
 * - 注册 9 组 API 路由
 * - 配置前端静态资源和 SPA 回退
 * - 初始化 WebSocket 服务（路径 /ws）
 *
 * @param port - 服务监听端口号
 * @returns 已启动监听的 HTTP Server 实例
 */
export async function createServer(port: number): Promise<http.Server> {
    const app = express();

    // 全局中间件
    app.use(cors());
    app.use(express.json());
    app.use(requestLogger);

    // 加载应用配置（必须在服务实例化之前）
    const configService = new ConfigService();
    let config;
    try {
        config = configService.load();
        console.log(`[config] loaded from ${configService.getConfigFile()}`);
    } catch (err) {
        console.warn(`[config] failed to load config, using defaults: ${err instanceof Error ? err.message : err}`);
        config = configService.getDefaultConfig();
    }

    // 实例化业务服务
    const mcpConfigService = new MCPConfigService();
    const mcpBridgeService = new MCPBridgeService(mcpConfigService);
    const workspaceService = new WorkspaceService();
    const cliRunnerService = new CLIRunnerService(config.cliProvider?.active);
    const testExecutorService = new TestExecutorService();
    const skillsService = new SkillsService();
    const pipelineService = new PipelineService();
    const requirementStore = new RequirementStoreService();

    // 旧版 requirements.json → 文件夹结构迁移
    requirementStore.migrateFromLegacy();

    // 旧版 plans.json / executions.json → 按需求文件夹存储迁移
    const planStoreMigrator = new PlanStoreService();
    planStoreMigrator.migrateFromLegacy();
    const executionStoreMigrator = new ExecutionStoreService();
    executionStoreMigrator.migrateFromLegacy();

    // 初始化沙箱服务
    const sandboxService = new SandboxService(config.daytona);
    testExecutorService.setSandboxService(sandboxService);

    // 初始化 MinerU 文档解析服务（旧配置文件无 mineru 字段时使用默认值）
    const mineruService = new MinerUService(config.mineru ?? configService.getDefaultConfig().mineru);

    // 记忆与分析子系统
    const memoryService = new MemoryService();
    const analyticsStore = new AnalyticsStoreService();
    const analyticsService = new AnalyticsService(analyticsStore, memoryService);
    const skillDerivationService = new SkillDerivationService(analyticsService, skillsService, analyticsStore);

    // 注册 API 路由
    app.use('/api/requirements', createRequirementsRoutes(mcpBridgeService, requirementStore, mineruService));
    app.use('/api/workspace', createWorkspaceRoutes(workspaceService));
    app.use('/api/plan', createPlanRoutes(cliRunnerService, mcpBridgeService, pipelineService, memoryService, mineruService));
    app.use('/api/execution', createExecutionRoutes(cliRunnerService, pipelineService, testExecutorService, memoryService, sandboxService));
    app.use('/api/tests', createTestRoutes(testExecutorService, cliRunnerService, skillsService, memoryService, sandboxService));
    app.use('/api/skills', createSkillsRoutes(skillsService));
    app.use('/api/mcp-servers', createMCPServersRoutes(mcpConfigService));
    app.use('/api/pipelines', createPipelineRoutes(pipelineService));
    app.use('/api/system', createSystemRoutes(cliRunnerService, mcpConfigService, sandboxService));
    app.use('/api/analytics', createAnalyticsRoutes(analyticsService, memoryService));
    app.use('/api/mineru', createMinerURoutes(mineruService));

    // 保留引用避免服务被 GC（它们的副作用是 eventBus 订阅）
    void analyticsService;
    void skillDerivationService;
    void memoryService;
    void mineruService;

    // 静态文件服务（生产模式）
    // 编译后 __dirname = dist/server/server/，前端资源位于 dist/client/
    const clientDistPath = path.resolve(__dirname, '../client');
    app.use(express.static(clientDistPath));

    // SPA 回退：非 API/WS 请求均返回 index.html
    // 注意：Express 的 app.get('*') 会匹配所有 GET 请求（包括 /api），
    // 当 API 路由已正确处理请求时不会到达此处；
    // 但为安全起见，仅对非 API 路径做 SPA 回退，其余调用 next() 继续处理链
    app.get('*', (req, res, next) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
            res.sendFile(path.join(clientDistPath, 'index.html'));
        } else {
            next();
        }
    });

    // 全局错误处理（必须注册在最后）
    app.use(errorHandler);

    // 创建 HTTP 服务器
    const server = http.createServer(app);

    // 初始化 WebSocket
    setupWebSocket(server);

    // 开始监听
    return new Promise((resolve) => {
        server.listen(port, '0.0.0.0', () => {
            // graceful shutdown: 清理 Daytona 沙箱
            const cleanup = async () => {
                await cliRunnerService.dispose();
                await sandboxService.cleanup();
                server.close();
                process.exit(0);
            };
            process.on('SIGINT', cleanup);
            process.on('SIGTERM', cleanup);

            resolve(server);
        });
    });
}
