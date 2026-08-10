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

import {SandboxService} from './services/sandbox-service.js';
import {MinerUService} from './services/mineru-service.js';
import {ConfigService} from './services/config-service.js';
import {TaskStoreService} from './services/task-store-service.js';
import {TaskScheduler} from './services/task-scheduler-service.js';

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
import {createTaskRoutes} from './routes/projects.js';
import {createAgentExecutionRoutes} from './routes/agent-execution.js';

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

    // 加载应用配置（必须在中间件和服务实例化之前）
    const configService = new ConfigService();
    let config: import('./services/config-service.js').AppConfig;
    try {
        config = configService.load();
        console.log(`[config] loaded from ${configService.getConfigFile()}`);
    } catch (err) {
        console.warn(`[config] failed to load config, using defaults: ${err instanceof Error ? err.message : err}`);
        config = configService.getDefaultConfig();
    }

    // 可选的 API Key 认证：仅在配置中显式设置时启用，避免默认锁定本地开发
    if (config.auth?.apiKey) {
        app.use((req, res, next) => {
            if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
                const provided = req.headers['x-api-key'] || req.query.apiKey;
                if (provided !== config.auth!.apiKey) {
                    res.status(401).json({code: 'UNAUTHORIZED', message: 'Invalid or missing API key'});
                    return;
                }
            }
            next();
        });
    }

    // 全局中间件
    if (config.security?.corsOrigin) {
        app.use(cors({origin: config.security.corsOrigin, credentials: true}));
    } else {
        app.use(cors());
    }
    app.use(express.json({limit: config.security?.maxRequestSize ?? '50mb'}));

    // 基础安全响应头
    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        next();
    });

    app.use(requestLogger);

    // 实例化业务服务
    const mcpConfigService = new MCPConfigService();
    const mcpBridgeService = new MCPBridgeService(mcpConfigService);
    const workspaceService = new WorkspaceService();
    const cliRunnerService = new CLIRunnerService(config.cliProvider?.active);
    const testExecutorService = new TestExecutorService();
    const skillsService = new SkillsService();

    // 将内置技能同步到 ~/.claude/skills/，使 Claude CLI 能够发现和加载
    const builtinSkillsSource = path.resolve(__dirname, '..', '..', 'skills');
    const syncResult = skillsService.syncBuiltinSkills(builtinSkillsSource);
    if (syncResult.synced > 0 || syncResult.errors > 0) {
        console.log(`[skills] sync builtin → ~/.claude/skills/: ${syncResult.synced} synced, ${syncResult.skipped} skipped, ${syncResult.errors} errors`);
    }
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

    // 多任务调度服务
    const taskStoreService = new TaskStoreService();
    const taskScheduler = new TaskScheduler(config.scheduler?.maxConcurrent ?? 3);

    // 注入流水线依赖，让 TaskScheduler 内部编排完整 plan→execution→test
    taskScheduler.setDependencies({
        requirementStore,
        mcpBridgeService,
        pipelineService,
        memoryService,
        workspaceService,
    });

    // 状态变更时自动持久化到磁盘
    taskScheduler.onPersist = (task) => {
        taskStoreService.upsert(task.projectId, {
            ...task,
        });
    };

    // 服务重启：从持久化存储恢复任务状态
    // running/queued/waiting_*_confirm 的任务标记为 paused（需要用户手动恢复）
    try {
        const allTasks = taskStoreService.listAll();
        for (const task of allTasks) {
            const needsPause = task.status === 'running' || task.status === 'queued'
                || task.phase === 'waiting_plan_confirm' || task.phase === 'waiting_execution_confirm';
            if (needsPause) {
                task.status = 'paused';
                task.phase = 'idle';
                task.updatedAt = new Date().toISOString();
                taskStoreService.upsert(task.projectId, task);
                console.log(`[task-scheduler] Recovered task ${task.id} (${task.name}) -> paused`);
            }
            // 注册到调度器内存
            taskScheduler.registerTask({
                ...task,
                logs: task.logs || [],
            });
        }
    } catch (err) {
        console.warn(`[task-scheduler] Failed to recover tasks: ${err instanceof Error ? err.message : err}`);
    }

    // 注册 API 路由
    app.use('/api/requirements', createRequirementsRoutes(mcpBridgeService, requirementStore, mineruService));
    app.use('/api/workspace', createWorkspaceRoutes(workspaceService));
    app.use('/api/plan', createPlanRoutes(cliRunnerService, mcpBridgeService, pipelineService, memoryService, mineruService));
    app.use('/api/execution', createExecutionRoutes(cliRunnerService, pipelineService, testExecutorService, memoryService, sandboxService, workspaceService));
    app.use('/api/tests', createTestRoutes(testExecutorService, cliRunnerService, skillsService, memoryService, sandboxService, workspaceService));
    app.use('/api/skills', createSkillsRoutes(skillsService, cliRunnerService));
    app.use('/api/mcp-servers', createMCPServersRoutes(mcpConfigService, cliRunnerService));
    app.use('/api/pipelines', createPipelineRoutes(pipelineService));
    app.use('/api/system', createSystemRoutes(cliRunnerService, mcpConfigService, sandboxService));
    app.use('/api/analytics', createAnalyticsRoutes(analyticsService, memoryService));
    app.use('/api/mineru', createMinerURoutes(mineruService));
    app.use('/api/tasks', createTaskRoutes(taskStoreService, taskScheduler, workspaceService));
    app.use('/api/agent-execution', createAgentExecutionRoutes({
        cliRunner: cliRunnerService,
        memoryService,
    }));

    // 保留引用避免服务被 GC（它们的副作用是 eventBus 订阅）
    void analyticsService;
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
    const host = config.server?.host ?? '127.0.0.1';
    return new Promise((resolve) => {
        server.listen(port, host, () => {
            // graceful shutdown: 清理 Daytona 沙箱
            const cleanup = async () => {
                await taskScheduler.dispose();
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
