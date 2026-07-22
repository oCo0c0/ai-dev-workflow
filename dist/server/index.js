"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const websocket_js_1 = require("./websocket.js");
const logger_js_1 = require("./middleware/logger.js");
const validation_js_1 = require("./middleware/validation.js");
// 服务层
const mcp_config_service_js_1 = require("./services/mcp-config-service.js");
const mcp_bridge_service_js_1 = require("./services/mcp-bridge-service.js");
const workspace_service_js_1 = require("./services/workspace-service.js");
const cli_runner_service_js_1 = require("./services/cli-runner-service.js");
const test_executor_service_js_1 = require("./services/test-executor-service.js");
const skills_service_js_1 = require("./services/skills-service.js");
const pipeline_service_js_1 = require("./services/pipeline-service.js");
const requirement_store_service_js_1 = require("./services/requirement-store-service.js");
const plan_store_service_js_1 = require("./services/plan-store-service.js");
const execution_store_service_js_1 = require("./services/execution-store-service.js");
const memory_service_js_1 = require("./services/memory/memory-service.js");
const analytics_store_service_js_1 = require("./services/analytics-store-service.js");
const analytics_service_js_1 = require("./services/analytics-service.js");
const skill_derivation_service_js_1 = require("./services/skill-derivation-service.js");
const sandbox_service_js_1 = require("./services/sandbox-service.js");
const mineru_service_js_1 = require("./services/mineru-service.js");
const config_service_js_1 = require("./services/config-service.js");
const task_store_service_js_1 = require("./services/task-store-service.js");
const task_scheduler_service_js_1 = require("./services/task-scheduler-service.js");
// 路由层
const requirements_js_1 = require("./routes/requirements.js");
const workspace_js_1 = require("./routes/workspace.js");
const plan_js_1 = require("./routes/plan.js");
const execution_js_1 = require("./routes/execution.js");
const tests_js_1 = require("./routes/tests.js");
const skills_js_1 = require("./routes/skills.js");
const mcp_servers_js_1 = require("./routes/mcp-servers.js");
const pipelines_js_1 = require("./routes/pipelines.js");
const system_js_1 = require("./routes/system.js");
const analytics_js_1 = require("./routes/analytics.js");
const mineru_js_1 = require("./routes/mineru.js");
const projects_js_1 = require("./routes/projects.js");
const agent_execution_js_1 = require("./routes/agent-execution.js");
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
async function createServer(port) {
    const app = (0, express_1.default)();
    // 加载应用配置（必须在中间件和服务实例化之前）
    const configService = new config_service_js_1.ConfigService();
    let config;
    try {
        config = configService.load();
        console.log(`[config] loaded from ${configService.getConfigFile()}`);
    }
    catch (err) {
        console.warn(`[config] failed to load config, using defaults: ${err instanceof Error ? err.message : err}`);
        config = configService.getDefaultConfig();
    }
    // 可选的 API Key 认证：仅在配置中显式设置时启用，避免默认锁定本地开发
    if (config.auth?.apiKey) {
        app.use((req, res, next) => {
            if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
                const provided = req.headers['x-api-key'] || req.query.apiKey;
                if (provided !== config.auth.apiKey) {
                    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid or missing API key' });
                    return;
                }
            }
            next();
        });
    }
    // 全局中间件
    if (config.security?.corsOrigin) {
        app.use((0, cors_1.default)({ origin: config.security.corsOrigin, credentials: true }));
    }
    else {
        app.use((0, cors_1.default)());
    }
    app.use(express_1.default.json({ limit: config.security?.maxRequestSize ?? '50mb' }));
    // 基础安全响应头
    app.use((_req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        next();
    });
    app.use(logger_js_1.requestLogger);
    // 实例化业务服务
    const mcpConfigService = new mcp_config_service_js_1.MCPConfigService();
    const mcpBridgeService = new mcp_bridge_service_js_1.MCPBridgeService(mcpConfigService);
    const workspaceService = new workspace_service_js_1.WorkspaceService();
    const cliRunnerService = new cli_runner_service_js_1.CLIRunnerService(config.cliProvider?.active);
    const testExecutorService = new test_executor_service_js_1.TestExecutorService();
    const skillsService = new skills_service_js_1.SkillsService();
    const pipelineService = new pipeline_service_js_1.PipelineService();
    const requirementStore = new requirement_store_service_js_1.RequirementStoreService();
    // 旧版 requirements.json → 文件夹结构迁移
    requirementStore.migrateFromLegacy();
    // 旧版 plans.json / executions.json → 按需求文件夹存储迁移
    const planStoreMigrator = new plan_store_service_js_1.PlanStoreService();
    planStoreMigrator.migrateFromLegacy();
    const executionStoreMigrator = new execution_store_service_js_1.ExecutionStoreService();
    executionStoreMigrator.migrateFromLegacy();
    // 初始化沙箱服务
    const sandboxService = new sandbox_service_js_1.SandboxService(config.daytona);
    testExecutorService.setSandboxService(sandboxService);
    // 初始化 MinerU 文档解析服务（旧配置文件无 mineru 字段时使用默认值）
    const mineruService = new mineru_service_js_1.MinerUService(config.mineru ?? configService.getDefaultConfig().mineru);
    // 记忆与分析子系统
    const memoryService = new memory_service_js_1.MemoryService();
    const analyticsStore = new analytics_store_service_js_1.AnalyticsStoreService();
    const analyticsService = new analytics_service_js_1.AnalyticsService(analyticsStore, memoryService);
    const skillDerivationService = new skill_derivation_service_js_1.SkillDerivationService(analyticsService, skillsService, analyticsStore);
    // 多任务调度服务
    const taskStoreService = new task_store_service_js_1.TaskStoreService();
    const taskScheduler = new task_scheduler_service_js_1.TaskScheduler(config.scheduler?.maxConcurrent ?? 3);
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
    }
    catch (err) {
        console.warn(`[task-scheduler] Failed to recover tasks: ${err instanceof Error ? err.message : err}`);
    }
    // 注册 API 路由
    app.use('/api/requirements', (0, requirements_js_1.createRequirementsRoutes)(mcpBridgeService, requirementStore, mineruService));
    app.use('/api/workspace', (0, workspace_js_1.createWorkspaceRoutes)(workspaceService));
    app.use('/api/plan', (0, plan_js_1.createPlanRoutes)(cliRunnerService, mcpBridgeService, pipelineService, memoryService, mineruService));
    app.use('/api/execution', (0, execution_js_1.createExecutionRoutes)(cliRunnerService, pipelineService, testExecutorService, memoryService, sandboxService, workspaceService));
    app.use('/api/tests', (0, tests_js_1.createTestRoutes)(testExecutorService, cliRunnerService, skillsService, memoryService, sandboxService, workspaceService));
    app.use('/api/skills', (0, skills_js_1.createSkillsRoutes)(skillsService, cliRunnerService));
    app.use('/api/mcp-servers', (0, mcp_servers_js_1.createMCPServersRoutes)(mcpConfigService, cliRunnerService));
    app.use('/api/pipelines', (0, pipelines_js_1.createPipelineRoutes)(pipelineService));
    app.use('/api/system', (0, system_js_1.createSystemRoutes)(cliRunnerService, mcpConfigService, sandboxService));
    app.use('/api/analytics', (0, analytics_js_1.createAnalyticsRoutes)(analyticsService, memoryService));
    app.use('/api/mineru', (0, mineru_js_1.createMinerURoutes)(mineruService));
    app.use('/api/tasks', (0, projects_js_1.createTaskRoutes)(taskStoreService, taskScheduler, workspaceService));
    app.use('/api/agent-execution', (0, agent_execution_js_1.createAgentExecutionRoutes)({
        cliRunner: cliRunnerService,
    }));
    // 保留引用避免服务被 GC（它们的副作用是 eventBus 订阅）
    void analyticsService;
    void skillDerivationService;
    void memoryService;
    void mineruService;
    // 静态文件服务（生产模式）
    // 编译后 __dirname = dist/server/server/，前端资源位于 dist/client/
    const clientDistPath = path_1.default.resolve(__dirname, '../client');
    app.use(express_1.default.static(clientDistPath));
    // SPA 回退：非 API/WS 请求均返回 index.html
    // 注意：Express 的 app.get('*') 会匹配所有 GET 请求（包括 /api），
    // 当 API 路由已正确处理请求时不会到达此处；
    // 但为安全起见，仅对非 API 路径做 SPA 回退，其余调用 next() 继续处理链
    app.get('*', (req, res, next) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
            res.sendFile(path_1.default.join(clientDistPath, 'index.html'));
        }
        else {
            next();
        }
    });
    // 全局错误处理（必须注册在最后）
    app.use(validation_js_1.errorHandler);
    // 创建 HTTP 服务器
    const server = http_1.default.createServer(app);
    // 初始化 WebSocket
    (0, websocket_js_1.setupWebSocket)(server);
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
//# sourceMappingURL=index.js.map