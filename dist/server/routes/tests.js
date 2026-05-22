"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestRoutes = createTestRoutes;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const test_store_service_js_1 = require("../services/test-store-service.js");
const validation_js_1 = require("../middleware/validation.js");
const websocket_js_1 = require("../websocket.js");
const prompt_enrichment_js_1 = require("../utils/prompt-enrichment.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 活跃测试运行的内存存储 Map
 */
const activeRuns = new Map();
/**
 * 创建测试管理路由
 * @param testExecutorService - 测试执行器服务（必需）
 * @param cliRunnerService - CLI 运行器服务（可选，AI 模式需要）
 * @param skillsService - 技能服务（可选，AI 模式 skill 选择器需要）
 * @param memoryService
 * @param sandboxService
 */
function createTestRoutes(testExecutorService, cliRunnerService, skillsService, memoryService, sandboxService) {
    const persistStore = new test_store_service_js_1.TestStoreService();
    const router = (0, express_1.Router)();
    /**
     * 将活跃测试运行对象转换为可持久化格式
     */
    function toPersisted(run) {
        const { abortController, changedFiles, ...rest } = run;
        return rest;
    }
    /**
     * GET /api/tests/list
     * @description 获取最近的测试运行记录列表
     */
    router.get('/list', (_req, res) => {
        try {
            const runs = persistStore.list().map(r => ({
                id: r.id,
                status: r.status,
                mode: r.mode,
                framework: r.framework,
                workspacePath: r.workspacePath,
                startedAt: r.startedAt,
                completedAt: r.completedAt,
                executionId: r.executionId,
                pipelineId: r.pipelineId,
                totalTests: r.results?.totalTests,
                passed: r.results?.passed,
                failed: r.results?.failed,
                skipped: r.results?.skipped,
            }));
            res.json(runs);
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * GET /api/tests/cli-available
     * @description 检查 CLI Runner 是否可用（前端据此决定是否显示 AI 模式选项）
     */
    router.get('/cli-available', async (_req, res) => {
        if (!cliRunnerService) {
            res.json({ available: false, error: 'CLI Runner service not injected' });
            return;
        }
        try {
            const info = await cliRunnerService.checkAvailability();
            res.json(info);
        }
        catch (err) {
            res.json({ available: false, error: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * GET /api/tests/skills
     * @description 列出可用 skills（AI 模式的 skill 选择器数据源）
     */
    router.get('/skills', (_req, res) => {
        if (!skillsService) {
            res.json([]);
            return;
        }
        try {
            const skills = skillsService.list();
            res.json(skills);
        }
        catch {
            res.json([]);
        }
    });
    /**
     * GET /api/tests/detect?workspacePath=
     * @description 自动检测指定工作区中使用的测试框架（兼容旧接口）
     */
    router.get('/detect', (req, res) => {
        try {
            const workspacePath = req.query.workspacePath;
            if (!workspacePath || workspacePath.trim() === '') {
                res.status(400).json({
                    code: 'VALIDATION_ERROR',
                    message: 'Query parameter "workspacePath" is required'
                });
                return;
            }
            const frameworks = testExecutorService.detectFrameworks(workspacePath);
            res.json(frameworks);
        }
        catch (err) {
            res.status(500).json({ code: 'TEST_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * GET /api/tests/detect-project?workspacePath=
     * @description 检测项目的完整信息（Provider 架构）
     * @returns ProjectInfo 包含项目类型、构建工具和所有测试框架详情
     */
    router.get('/detect-project', (req, res) => {
        try {
            const workspacePath = req.query.workspacePath;
            if (!workspacePath || workspacePath.trim() === '') {
                res.status(400).json({
                    code: 'VALIDATION_ERROR',
                    message: 'Query parameter "workspacePath" is required'
                });
                return;
            }
            const projectInfo = testExecutorService.detectProject(workspacePath);
            if (!projectInfo) {
                res.json({
                    type: 'unknown',
                    label: 'Unknown Project',
                    buildTool: 'unknown',
                    testFrameworks: [],
                    rootPath: workspacePath,
                });
                return;
            }
            res.json(projectInfo);
        }
        catch (err) {
            res.status(500).json({ code: 'TEST_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * GET /api/tests/targets?workspacePath=&changedFiles=
     * @description 根据变更文件列出可运行的测试目标
     */
    router.get('/targets', (req, res) => {
        try {
            const workspacePath = req.query.workspacePath;
            const changedFilesParam = req.query.changedFiles;
            if (!workspacePath) {
                res.status(400).json({
                    code: 'VALIDATION_ERROR',
                    message: 'Query parameter "workspacePath" is required'
                });
                return;
            }
            const changedFiles = changedFilesParam
                ? changedFilesParam.split(',').map(f => f.trim()).filter(Boolean)
                : [];
            const targets = testExecutorService.listTestTargets(workspacePath, changedFiles);
            res.json(targets);
        }
        catch (err) {
            res.status(500).json({ code: 'TEST_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * POST /api/tests/run
     * @description 触发测试运行，支持三种模式分流
     *
     * @body workspacePath - 工作区路径（必填）
     * @body mode - 运行模式：run_existing（默认）/ ai_generate / ai_generate_e2e
     * @body framework - 测试框架名称（可选，run_existing 模式）
     * @body command - 自定义命令（可选，run_existing 模式）
     * @body changedFiles - 变更文件列表（可选，run_existing 模式定向测试）
     * @body skills - AI 使用的 skills 列表（可选，ai_generate / ai_generate_e2e 模式）
     * @body customPrompt - 自定义 prompt（可选，ai_generate / ai_generate_e2e 模式）
     * @body executionId - 关联执行ID（可选）
     * @body planId - 关联计划ID（可选）
     * @body pipelineId - 关联流水线ID（可选）
     */
    router.post('/run', (0, validation_js_1.validateBody)([
        { field: 'workspacePath', required: true, type: 'string' },
    ]), async (req, res) => {
        const { framework, command, workspacePath, mode: requestMode, executionId, planId, pipelineId, changedFiles, skills: requestSkills, customPrompt, environment, sandboxId, } = req.body;
        const taskId = crypto_1.default.randomUUID();
        const abortController = new AbortController();
        const resolvedMode = requestMode || 'run_existing';
        const run = {
            id: taskId,
            status: 'running',
            mode: resolvedMode === 'ai_generate' ? 'manual_ai_generate'
                : resolvedMode === 'ai_generate_e2e' ? 'manual_ai_generate_e2e'
                    : (executionId ? 'pipeline_run_existing' : 'manual'),
            framework,
            workspacePath,
            startedAt: new Date().toISOString(),
            executionId,
            planId,
            pipelineId,
            changedFiles,
            abortController,
            environment: environment || 'local',
            sandboxId,
            phases: environment === 'sandbox' ? [] : undefined,
        };
        activeRuns.set(taskId, run);
        persistStore.upsert(toPersisted(run));
        res.json({ taskId });
        // === 模式分流 ===
        if (resolvedMode === 'ai_generate') {
            // --- AI 生成模式：Claude 分析代码、编写测试、运行并报告 ---
            await handleAiGenerateMode(run, workspacePath, requestSkills, customPrompt, environment, sandboxId);
        }
        else if (resolvedMode === 'ai_generate_e2e') {
            // --- AI E2E 模式：两阶段（生成 Playwright 文件 → Provider 执行） ---
            await handleAiE2EMode(run, workspacePath, requestSkills, customPrompt);
        }
        else {
            // --- 运行已有测试（默认，保持原有逻辑不变） ---
            await handleRunExistingMode(run, workspacePath, framework, command, changedFiles);
        }
    });
    /**
     * 获取变更文件列表
     * 优先使用前端传入的 changedFiles，否则通过 git 命令自动获取：
     * - git diff --name-only HEAD: 已跟踪文件的修改/删除
     * - git ls-files --others --exclude-standard: 未跟踪的新文件
     * - git diff --cached --name-only: 已暂存但未提交的文件
     */
    async function getChangedFiles(workspacePath, existingChangedFiles) {
        // 前端已传入变更文件列表
        if (existingChangedFiles && existingChangedFiles.length > 0) {
            return existingChangedFiles;
        }
        // 自动通过 git 获取变更文件
        try {
            const { execSync } = await import('child_process');
            const changed = new Set();
            const run = (cmd) => {
                try {
                    const output = execSync(cmd, {
                        cwd: workspacePath,
                        encoding: 'utf-8',
                        timeout: 10000,
                    });
                    output.split('\n').map(f => f.trim()).filter(Boolean).forEach(f => changed.add(f));
                }
                catch {
                    // 单条命令失败不影响其他命令
                }
            };
            // 已跟踪文件的修改和删除
            run('git diff --name-only HEAD');
            // 已暂存但未提交的文件
            run('git diff --cached --name-only');
            // 未跟踪的新文件（排除 .gitignore 中的文件）
            run('git ls-files --others --exclude-standard');
            return [...changed];
        }
        catch {
            return [];
        }
    }
    /**
     * 处理运行已有测试模式
     */
    async function handleRunExistingMode(run, workspacePath, framework, command, changedFiles) {
        try {
            const results = await testExecutorService.runTests({
                workspacePath,
                framework,
                command,
                changedFiles,
                taskId: run.id,
            }, {
                signal: run.abortController?.signal,
                onOutput: (data) => {
                    run.rawOutput = (run.rawOutput || '') + data;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data } });
                },
                onError: (data) => {
                    run.rawOutput = (run.rawOutput || '') + data;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data } });
                },
            });
            run.status = 'completed';
            run.results = results;
            run.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: run.id, results, status: 'completed' } });
        }
        catch (err) {
            run.status = 'failed';
            run.error = (0, error_utils_js_1.getErrorMessage)(err);
            // 确保即使 spawn 失败也有错误输出
            if (!run.rawOutput) {
                run.rawOutput = `[Test execution failed]\n${run.error}\n\nPossible causes:\n- Test framework not installed (run npm install / pip install)\n- No test files found in workspace\n- Invalid test configuration\n- Command not found or not in PATH`;
            }
            run.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({
                type: 'test:complete',
                data: {
                    taskId: run.id,
                    status: 'failed',
                    error: run.error,
                    rawOutput: run.rawOutput,
                },
            });
        }
        finally {
            activeRuns.delete(run.id);
        }
    }
    /**
     * 处理 AI 生成测试模式
     * Claude 分析代码变更，编写测试，运行并修复失败用例
     */
    async function handleAiGenerateMode(run, workspacePath, skills, customPrompt, environment, reqSandboxId) {
        if (!cliRunnerService) {
            run.status = 'failed';
            run.error = 'CLI Runner service not available. AI mode requires Claude CLI.';
            run.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: run.error } });
            activeRuns.delete(run.id);
            return;
        }
        console.log(`[tests:ai] handleAiGenerateMode started, taskId=${run.id}, env=${environment}`);
        // 获取变更文件列表，用于生成针对性测试
        const changedFiles = await getChangedFiles(workspacePath, run.changedFiles);
        const changedContext = changedFiles.length > 0
            ? `\n## Changed Files (${changedFiles.length} files)\n${changedFiles.map(f => `- ${f}`).join('\n')}\n\nFocus on writing tests for the changed files above. Map source files to their corresponding test files using project conventions.`
            : '';
        const isSandboxMode = environment === 'sandbox' && !!reqSandboxId && !!sandboxService?.isEnabled();
        console.log(`[tests:ai] sandbox check: environment=${environment}, sandboxId=${reqSandboxId || 'none'}, sandboxEnabled=${sandboxService?.isEnabled()}, isSandboxMode=${isSandboxMode}`);
        if (isSandboxMode) {
            // === 沙箱三阶段流程 ===
            await handleAiGenerateSandbox(run, workspacePath, skills, customPrompt, changedFiles, changedContext, reqSandboxId);
        }
        else {
            // === 原有本地一体化流程 ===
            const prompt = customPrompt || `Analyze the code changes in this workspace and write appropriate tests.\n\n## Context\n- Workspace: ${workspacePath}${changedContext}\n## Instructions\n1. Review the changed files listed above (or the overall codebase if no changes detected)\n2. Map each changed source file to its corresponding test file using project conventions (e.g., foo.ts → foo.test.ts, Bar.java → BarTest.java)\n3. Write appropriate unit and/or integration tests covering the changed functionality\n4. Run the tests and report results\n5. If tests fail, fix the issues and re-run\n\nRespond in the same language as the project.`;
            let accumulatedOutput = '';
            try {
                console.log(`[tests:ai] calling runBridge, taskId=${run.id}`);
                const result = await cliRunnerService.runBridge({
                    prompt: (0, prompt_enrichment_js_1.enrichPrompt)(prompt, memoryService, workspacePath),
                    cwd: workspacePath,
                    maxTurns: 30,
                    skills: skills && skills.length > 0 ? skills : undefined,
                }, {
                    workspacePath,
                    onOutput: (data) => {
                        accumulatedOutput += data;
                        run.rawOutput = accumulatedOutput;
                        (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data } });
                    },
                    onError: (data) => {
                        console.error(`[tests:ai] bridge stderr: ${data}`);
                    },
                    signal: run.abortController?.signal,
                });
                console.log(`[tests:ai] runBridge completed, exitCode=${result.exitCode}, aborted=${result.aborted}, outputLen=${accumulatedOutput.length}, taskId=${run.id}`);
                if (run.status !== 'failed') {
                    run.status = 'completed';
                    run.rawOutput = accumulatedOutput;
                    run.completedAt = new Date().toISOString();
                    persistStore.upsert(toPersisted(run));
                    (0, websocket_js_1.broadcast)({
                        type: 'test:complete',
                        data: { taskId: run.id, status: 'completed', rawOutput: accumulatedOutput },
                    });
                }
            }
            catch (err) {
                console.error(`[tests:ai] runBridge error:`, err);
                if (run.status !== 'failed') {
                    run.status = 'failed';
                    run.error = (0, error_utils_js_1.getErrorMessage)(err);
                    run.rawOutput = accumulatedOutput;
                    run.completedAt = new Date().toISOString();
                    persistStore.upsert(toPersisted(run));
                    (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `AI test generation failed: ${run.error}` } });
                }
            }
            finally {
                activeRuns.delete(run.id);
                console.log(`[tests:ai] handleAiGenerateMode done, taskId=${run.id}`);
            }
        }
    }
    /**
     * ai_generate 模式的沙箱三阶段测试流程（手动测试入口）
     */
    async function handleAiGenerateSandbox(run, workspacePath, skills, customPrompt, changedFiles, changedContext, reqSandboxId) {
        const phases = run.phases;
        const resolvedSkills = skills && skills.length > 0 ? skills : undefined;
        try {
            // === Phase 1: AI 编写测试文件（本地） ===
            run.currentPhase = 'writing';
            phases.push({
                phase: 'writing',
                label: 'AI 编写测试文件',
                startedAt: new Date().toISOString(),
                status: 'running'
            });
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({ type: 'test:phase_change', data: { taskId: run.id, phase: 'writing', label: 'AI 编写测试文件' } });
            const writeOnlyPrompt = customPrompt || `Analyze the code changes in this workspace and write appropriate tests.\n\n## Context\n- Workspace: ${workspacePath}${changedContext || ''}\n## Instructions\n1. Review the changed files listed above (or the overall codebase if no changes detected)\n2. Map each changed source file to its corresponding test file using project conventions\n3. Write appropriate unit and/or integration tests\n4. Save the test files to the project\n\nIMPORTANT: Do NOT run the tests. Only write and save the test files. Tests will be executed in a separate environment.\n\nRespond in the same language as the project.`;
            let phase1Output = '';
            const phase1Result = await cliRunnerService.runBridge({
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(writeOnlyPrompt, memoryService, workspacePath),
                cwd: workspacePath,
                maxTurns: 20,
                skills: resolvedSkills,
            }, {
                workspacePath,
                onOutput: (data) => {
                    phase1Output += data;
                    run.rawOutput = phase1Output;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data, phase: 'writing' } });
                },
                signal: run.abortController?.signal,
            });
            phases[0].completedAt = new Date().toISOString();
            phases[0].status = phase1Result.exitCode === 0 ? 'completed' : 'failed';
            persistStore.upsert(toPersisted(run));
            if (phase1Result.exitCode !== 0) {
                run.status = 'failed';
                run.error = 'AI test file generation failed';
                run.completedAt = new Date().toISOString();
                persistStore.upsert(toPersisted(run));
                (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: run.id, status: 'failed', error: run.error } });
                return;
            }
            // === Phase 2: 沙箱执行测试 ===
            run.currentPhase = 'sandbox_run';
            phases.push({
                phase: 'sandbox_run',
                label: '在沙箱中执行测试',
                startedAt: new Date().toISOString(),
                status: 'running'
            });
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({
                type: 'test:phase_change',
                data: { taskId: run.id, phase: 'sandbox_run', label: '在沙箱中执行测试' }
            });
            const syncOk = await sandboxService.syncChangedFiles(workspacePath, reqSandboxId);
            if (!syncOk) {
                phases[1].completedAt = new Date().toISOString();
                phases[1].status = 'failed';
                run.status = 'failed';
                run.error = `Sandbox "${reqSandboxId}" is not available. File sync failed.`;
                run.completedAt = new Date().toISOString();
                persistStore.upsert(toPersisted(run));
                (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: run.id, status: 'failed', error: run.error } });
                return;
            }
            const sandboxResults = await testExecutorService.runTests({
                workspacePath,
                taskId: run.id,
                sandboxId: reqSandboxId,
                changedFiles,
            }, {
                onOutput: (data) => {
                    run.rawOutput = (run.rawOutput || '') + '\n--- Sandbox Test Output ---\n' + data;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data, phase: 'sandbox_run' } });
                },
            });
            phases[1].completedAt = new Date().toISOString();
            phases[1].status = 'completed';
            run.results = sandboxResults;
            persistStore.upsert(toPersisted(run));
            // === Phase 3: AI 修复（条件执行） ===
            if (sandboxResults.failed > 0) {
                run.currentPhase = 'fixing';
                phases.push({
                    phase: 'fixing',
                    label: 'AI 修复失败用例',
                    startedAt: new Date().toISOString(),
                    status: 'running'
                });
                persistStore.upsert(toPersisted(run));
                (0, websocket_js_1.broadcast)({
                    type: 'test:phase_change',
                    data: { taskId: run.id, phase: 'fixing', label: 'AI 修复失败用例' }
                });
                const failureDetails = sandboxResults.suites
                    ?.flatMap(s => s.tests?.filter(t => t.status === 'failed').map(t => `- [${s.name}] ${t.name}: ${t.error || 'Unknown error'}`) ?? [])
                    .join('\n') || `${sandboxResults.failed} test(s) failed`;
                const fixPrompt = `The following tests failed when executed in the sandbox:\n\n${failureDetails}\n\n## Context\n- Workspace: ${workspacePath}\n\n## Instructions\n1. Analyze the test failures above\n2. Fix the test files or source code to resolve the failures\n3. Do NOT run the tests - they will be executed separately\n\nRespond in the same language as the project.`;
                let phase3Output = '';
                const fixResult = await cliRunnerService.runBridge({
                    prompt: (0, prompt_enrichment_js_1.enrichPrompt)(fixPrompt, memoryService, workspacePath),
                    cwd: workspacePath,
                    maxTurns: 15,
                    skills: resolvedSkills,
                }, {
                    workspacePath,
                    onOutput: (data) => {
                        phase3Output += data;
                        run.rawOutput = (run.rawOutput || '') + '\n--- AI Fix Output ---\n' + data;
                        (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data, phase: 'fixing' } });
                    },
                    signal: run.abortController?.signal,
                });
                const fixPhase = phases.find(p => p.phase === 'fixing');
                fixPhase.completedAt = new Date().toISOString();
                fixPhase.status = fixResult.exitCode === 0 ? 'completed' : 'failed';
                if (fixResult.exitCode === 0) {
                    // 重新在沙箱中执行测试
                    run.currentPhase = 'sandbox_rerun';
                    phases.push({
                        phase: 'sandbox_rerun',
                        label: '在沙箱中重新执行测试',
                        startedAt: new Date().toISOString(),
                        status: 'running'
                    });
                    persistStore.upsert(toPersisted(run));
                    (0, websocket_js_1.broadcast)({
                        type: 'test:phase_change',
                        data: { taskId: run.id, phase: 'sandbox_rerun', label: '在沙箱中重新执行测试' }
                    });
                    const resyncOk = await sandboxService.syncChangedFiles(workspacePath, reqSandboxId);
                    if (!resyncOk) {
                        const rerunPhase = phases.find(p => p.phase === 'sandbox_rerun');
                        rerunPhase.completedAt = new Date().toISOString();
                        rerunPhase.status = 'failed';
                        run.status = 'failed';
                        run.error = `Sandbox "${reqSandboxId}" is not available. File sync failed during re-run.`;
                        run.completedAt = new Date().toISOString();
                        persistStore.upsert(toPersisted(run));
                        (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: run.id, status: 'failed', error: run.error } });
                        return;
                    }
                    const rerunResults = await testExecutorService.runTests({
                        workspacePath,
                        taskId: run.id,
                        sandboxId: reqSandboxId,
                        changedFiles,
                    }, {
                        onOutput: (data) => {
                            run.rawOutput = (run.rawOutput || '') + '\n--- Sandbox Re-run Output ---\n' + data;
                            (0, websocket_js_1.broadcast)({
                                type: 'test:output',
                                data: { taskId: run.id, content: data, phase: 'sandbox_rerun' }
                            });
                        },
                    });
                    const rerunPhase = phases.find(p => p.phase === 'sandbox_rerun');
                    rerunPhase.completedAt = new Date().toISOString();
                    rerunPhase.status = 'completed';
                    run.results = rerunResults;
                }
            }
            // 最终完成
            run.status = 'completed';
            run.currentPhase = undefined;
            run.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: run.id, status: 'completed', results: run.results } });
        }
        catch (err) {
            run.status = 'failed';
            run.error = (0, error_utils_js_1.getErrorMessage)(err);
            run.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `AI sandbox test failed: ${run.error}` } });
        }
        finally {
            activeRuns.delete(run.id);
        }
    }
    /**
     * 处理 AI E2E 测试模式（两阶段）
     * Phase 1: Claude 生成 Playwright .spec.ts 测试文件
     * Phase 2: Playwright Provider 结构化执行生成的测试文件
     */
    async function handleAiE2EMode(run, workspacePath, skills, customPrompt) {
        if (!cliRunnerService) {
            run.status = 'failed';
            run.error = 'CLI Runner service not available. AI mode requires Claude CLI.';
            run.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(run));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: run.error } });
            activeRuns.delete(run.id);
            return;
        }
        // Phase 1: AI 生成 Playwright 测试文件
        const changedFiles = await getChangedFiles(workspacePath, run.changedFiles);
        const changedContext = changedFiles.length > 0
            ? `\n## Changed Files (${changedFiles.length} files)\n${changedFiles.map(f => `- ${f}`).join('\n')}\n\nFocus on generating E2E tests for the UI/frontend changes above.`
            : '';
        const e2ePrompt = customPrompt || `Generate Playwright E2E tests for the recent changes in this project.\n\n## Context\n- Workspace: ${workspacePath}${changedContext}\n## Instructions\n1. Review the changed files listed above (or the overall codebase if no changes detected), focusing on UI/frontend components\n2. Use the Playwright MCP browser tools to explore the application UI if needed\n3. Generate Playwright test files and save them to the project's e2e/ or tests/e2e/ directory\n4. Each test file should import from '@playwright/test', test key user flows affected by the changes, and include appropriate assertions\n5. After generating the files, verify they exist on disk\n\nImportant: Write the test files to disk using file write tools. Do NOT run the tests - they will be executed separately.\n\nRespond in the same language as the project.`;
        let accumulatedOutput = '';
        try {
            const result = await cliRunnerService.runBridge({
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(e2ePrompt, memoryService, workspacePath),
                cwd: workspacePath,
                maxTurns: 30,
                skills: skills && skills.length > 0 ? skills : undefined,
            }, {
                workspacePath,
                onOutput: (data) => {
                    accumulatedOutput += data;
                    run.rawOutput = accumulatedOutput;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: run.id, content: data } });
                },
                signal: run.abortController?.signal,
            });
            // abort: bridge resolve {aborted: true}, run.status already set to failed by cancel handler
            if (run.status === "failed") {
                // Cancelled, skip Phase 1 result handling
            }
            else {
                // Phase 1 done
                run.status = result.exitCode === 0 ? "completed" : "failed";
                run.rawOutput = accumulatedOutput;
                run.completedAt = new Date().toISOString();
                if (result.exitCode !== 0)
                    run.error = "AI E2E test generation failed";
                persistStore.upsert(toPersisted(run));
                (0, websocket_js_1.broadcast)({
                    type: "test:complete",
                    data: { taskId: run.id, status: run.status, rawOutput: accumulatedOutput },
                });
            }
            // Phase 2: auto-run Playwright if Phase 1 succeeded and not cancelled
            if (run.status !== "failed" && result.exitCode === 0) {
                const e2eRunId = crypto_1.default.randomUUID();
                const e2eRun = {
                    id: e2eRunId,
                    status: "running",
                    mode: "manual",
                    framework: "playwright",
                    workspacePath,
                    executionId: run.executionId,
                    planId: run.planId,
                    pipelineId: run.pipelineId,
                    startedAt: new Date().toISOString(),
                    abortController: new AbortController(),
                };
                activeRuns.set(e2eRunId, e2eRun);
                persistStore.upsert(toPersisted(e2eRun));
                (0, websocket_js_1.broadcast)({
                    type: "test:auto_start",
                    data: { testRunId: e2eRunId, executionId: run.executionId, mode: "run_existing" },
                });
                try {
                    const e2eResults = await testExecutorService.runTests({ workspacePath, framework: "playwright", taskId: e2eRunId }, {
                        onOutput: (data) => {
                            e2eRun.rawOutput = (e2eRun.rawOutput || "") + data;
                            (0, websocket_js_1.broadcast)({ type: "test:output", data: { taskId: e2eRunId, content: data } });
                        },
                    });
                    e2eRun.status = "completed";
                    e2eRun.results = e2eResults;
                    e2eRun.completedAt = new Date().toISOString();
                    persistStore.upsert(toPersisted(e2eRun));
                    (0, websocket_js_1.broadcast)({
                        type: "test:complete",
                        data: { taskId: e2eRunId, results: e2eResults, status: "completed" }
                    });
                }
                catch (err) {
                    e2eRun.status = "failed";
                    e2eRun.error = (0, error_utils_js_1.getErrorMessage)(err);
                    e2eRun.completedAt = new Date().toISOString();
                    persistStore.upsert(toPersisted(e2eRun));
                    (0, websocket_js_1.broadcast)({ type: "error", data: { message: "E2E test execution failed: " + e2eRun.error } });
                }
                finally {
                    activeRuns.delete(e2eRunId);
                }
            }
        }
        catch (err) {
            if (run.status !== "failed") {
                run.status = "failed";
                run.error = (0, error_utils_js_1.getErrorMessage)(err);
                run.rawOutput = accumulatedOutput;
                run.completedAt = new Date().toISOString();
                persistStore.upsert(toPersisted(run));
                (0, websocket_js_1.broadcast)({ type: "error", data: { message: "AI E2E test generation failed: " + run.error } });
            }
        }
        finally {
            activeRuns.delete(run.id);
        }
    }
    /**
     * POST /api/tests/:taskId/cancel
     * @description 取消正在运行的测试任务
     *
     * 对 AI 模式：abort 信号会传递给 bridge 进程（通过 AbortSignal），
     * bridge 的 send() 会监听 abort 事件并 resolve {aborted: true}，
     * 随后 handleAiGenerateMode 的 await 正常返回，进入 finally 清理。
     *
     * 对 run_existing 模式：额外调用 testExecutorService.cancel() 终止测试子进程。
     */
    router.post('/:taskId/cancel', (req, res) => {
        const run = activeRuns.get(req.params.taskId);
        if (!run || run.status !== 'running') {
            res.status(404).json({ code: 'NOT_FOUND', message: 'No active test run' });
            return;
        }
        // 标记为已取消，防止 handleAi* 函数在 abort 后覆盖状态
        run.status = 'failed';
        run.error = 'Cancelled by user';
        run.completedAt = new Date().toISOString();
        // 触发 abort 信号，传播给所有模式（bridge / testExecutor）
        run.abortController?.abort();
        // run_existing 模式额外清理 testExecutor 的子进程
        testExecutorService.cancel(req.params.taskId);
        persistStore.upsert(toPersisted(run));
        (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: run.id, status: 'failed', error: run.error } });
        // 注意：不在此处 delete activeRun，让 handleAi* 的 finally 统一清理
        // 因为 bridge Promise resolve 是异步的，如果提前 delete，handleAi* 的 catch 里找不到 run
        res.json({ ok: true });
    });
    /**
     * GET /api/tests/results/:taskId
     * @description 获取指定测试运行的完整结果
     */
    router.get('/results/:taskId', (req, res) => {
        const active = activeRuns.get(req.params.taskId);
        if (active) {
            const { abortController, ...rest } = active;
            res.json(rest);
            return;
        }
        const persisted = persistStore.get(req.params.taskId);
        if (!persisted) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Test run not found' });
            return;
        }
        res.json(persisted);
    });
    /**
     * DELETE /api/tests/:id
     * @description 删除测试运行记录
     */
    router.delete('/:id', (req, res) => {
        // 如果正在运行则先取消
        const run = activeRuns.get(req.params.id);
        if (run) {
            run.abortController?.abort();
            testExecutorService.cancel(req.params.id);
            activeRuns.delete(req.params.id);
        }
        const deleted = persistStore.delete(req.params.id);
        res.json({ success: deleted });
    });
    return router;
}
//# sourceMappingURL=tests.js.map