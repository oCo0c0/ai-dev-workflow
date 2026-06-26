"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlanStore = getPlanStore;
exports.createPlanRoutes = createPlanRoutes;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const xlsx_1 = __importDefault(require("xlsx"));
const validation_js_1 = require("../middleware/validation.js");
const websocket_js_1 = require("../websocket.js");
const plan_store_service_js_1 = require("../services/plan-store-service.js");
const requirement_store_service_js_1 = require("../services/requirement-store-service.js");
const skill_utils_js_1 = require("../utils/skill-utils.js");
const prompt_enrichment_js_1 = require("../utils/prompt-enrichment.js");
const error_utils_js_1 = require("../utils/error-utils.js");
const lru_cache_js_1 = require("../utils/lru-cache.js");
/** Bridge 调用超时时间（30 分钟） */
const BRIDGE_TIMEOUT_MS = 30 * 60 * 1000;
/** 计划生成时的系统提示模板 */
const PLAN_PROMPT_TEMPLATE = `Analyze the following requirement and generate a structured development plan.\n\n## Requirement\n{title}\n\n{description}\n\n## Instructions\nGenerate a development plan. Respond in the same language as the requirement.`;
/** 列名 → 数组下标的映射 */
const HEADER_ALIASES = {
    '需求号ID': ['requirementId', '需求号', '需求号ID'],
    '任务ID（如有）': ['taskId', '任务ID', '任务编号'],
    '标题': ['title', '标题', 'name'],
    '描述': ['description', '描述', 'desc', 'detail'],
    '负责人': ['assignee', '负责人', 'owner'],
    '状态': ['status', '状态'],
    '所属项目': ['project', '所属项目', 'projectName'],
    '所属产品': ['product', '所属产品', 'productName'],
    '工作项类型': ['workItemType', '工作项类型', 'type', 'itemType'],
    '优先级': ['priority', '优先级'],
    '预估工时（小时）': ['estimatedHours', '预估工时', 'hours', 'effort'],
    '计划开始日期': ['startDate', '计划开始日期', 'start'],
    '计划完成日期': ['endDate', '计划完成日期', 'end', 'due'],
    '任务拆解类型': ['taskType', '任务拆解类型', 'category'],
    '任务复杂度': ['complexity', '任务复杂度', 'difficulty'],
    '需求开发主程': ['devLead', '需求开发主程'],
    '需求测试主程': ['testLead', '需求测试主程'],
};
/**
 * 从 markdown 表格提取任务行。
 * 表头按 TaskExportRow 别名映射，单元格按列对齐。
 * 跳过分隔行（|---|---|）。
 */
function parseMarkdownTable(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('|') && l.endsWith('|'));
    if (lines.length < 2)
        return [];
    // 反向索引：alias 值 → field key（中文表头也能匹配到 field）
    const aliasToField = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        aliasToField[field] = field;
        for (const a of aliases)
            aliasToField[a] = field;
    }
    // canonical "标题" field key（aliases 含 'title'）
    const titleFieldKey = Object.keys(HEADER_ALIASES).find(k => HEADER_ALIASES[k].includes('title'));
    const descFieldKey = Object.keys(HEADER_ALIASES).find(k => HEADER_ALIASES[k].includes('description'));
    // 找同时含"标题"+"描述"列的表头行
    let headerLineIdx = -1;
    let colIndex = {};
    for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c) || c === ''))
            continue;
        const fields = cells.map(c => aliasToField[c]).filter(Boolean);
        if (fields.includes(titleFieldKey) && fields.includes(descFieldKey)) {
            headerLineIdx = i;
            cells.forEach((h, idx) => {
                const f = aliasToField[h];
                if (f && colIndex[f] === undefined)
                    colIndex[f] = idx;
            });
            break;
        }
    }
    if (headerLineIdx < 0)
        return [];
    const rows = [];
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c) || c === ''))
            continue;
        // 下一个表头行（含 title 列 + 5+ 匹配列）则停止
        if (cells.some(c => aliasToField[c] === titleFieldKey) && cells.filter(c => aliasToField[c]).length >= 5) {
            break;
        }
        const row = {};
        for (const [field, idx] of Object.entries(colIndex)) {
            const val = cells[idx];
            if (val !== undefined && val !== '' && val !== '—') {
                row[field] = val;
            }
        }
        // 有效行：标题或描述非空
        if (row[titleFieldKey] || row[descFieldKey]) {
            rows.push(row);
        }
    }
    return rows;
}
/**
 * 从 raw text 提取任务列表。
 * 优先 JSON（数组或 {tasks:[]}），降级 markdown 表格。
 */
function extractTasksFromOutput(raw) {
    if (!raw)
        return null;
    // 1. JSON fenced block
    const jsonFenced = raw.match(/```json\s*([\s\S]*?)```/);
    if (jsonFenced) {
        try {
            const parsed = JSON.parse(jsonFenced[1].trim());
            const arr = Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
            if (Array.isArray(arr) && arr.length)
                return arr;
        }
        catch { /* fallthrough */
        }
    }
    // 2. 裸 JSON 数组
    const jsonBare = raw.match(/(\[[\s\S]*\])/);
    if (jsonBare) {
        try {
            const parsed = JSON.parse(jsonBare[1].trim());
            if (Array.isArray(parsed) && parsed.length)
                return parsed;
        }
        catch { /* fallthrough */
        }
    }
    // 3. markdown 表格（技能默认输出格式）
    const mdTasks = parseMarkdownTable(raw);
    return mdTasks.length ? mdTasks : null;
}
/**
 * 解析「下拉字段」sheet，返回列名 → 枚举值数组。
 * 第 0 行是表头（列名），后续行是枚举值。
 */
function parseDropdowns(sheet) {
    if (!sheet)
        return {};
    const rows = xlsx_1.default.utils.sheet_to_json(sheet, { header: 1 });
    if (!rows.length)
        return {};
    const headers = rows[0];
    const result = {};
    for (let col = 0; col < headers.length; col++) {
        const name = headers[col]?.trim();
        if (!name)
            continue;
        const values = [];
        for (let r = 1; r < rows.length; r++) {
            const v = rows[r][col];
            if (typeof v === 'string' && v.trim())
                values.push(v.trim());
            else if (typeof v === 'number')
                values.push(String(v));
        }
        result[name] = values;
    }
    return result;
}
/** 在枚举数组中找最接近的值（大小写不敏感包含匹配），找不到返回空字符串 */
function matchClosestEnum(value, enumValues) {
    if (!value)
        return '';
    const lower = value.toLowerCase().trim();
    // 精确匹配
    const exact = enumValues.find(v => v.toLowerCase() === lower);
    if (exact)
        return exact;
    // 包含匹配
    const contains = enumValues.find(v => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase()));
    return contains ?? '';
}
/** 取字段值（按别名优先级） */
function pick(row, aliases) {
    for (const a of aliases) {
        const v = row[a];
        if (typeof v === 'string' && v.trim())
            return v.trim();
        if (typeof v === 'number')
            return String(v);
    }
    return '';
}
/** 构造单行导出数据（按 headers 顺序，下拉列做枚举校验） */
function buildExportRow(task, index, headers, dropdowns, ctx) {
    const rowObj = {};
    headers.forEach(h => {
        const aliases = HEADER_ALIASES[h] ?? [];
        let value = pick(task, aliases);
        // 上下文覆盖
        if (h === '需求号ID' && !value)
            value = ctx.requirementId;
        if (h === '所属项目' && !value)
            value = ctx.project;
        if (h === '需求开发主程' && !value)
            value = ctx.devLead;
        if (h === '需求测试主程' && !value)
            value = ctx.testLead;
        if (h === '任务ID（如有）' && !value)
            value = String(index);
        // 下拉列：必须用枚举值，不在则匹配最接近，仍找不到则留空
        if (dropdowns[h] && dropdowns[h].length > 0) {
            value = matchClosestEnum(value, dropdowns[h]);
        }
        // 工时转数字
        if (h === '预估工时（小时）' && value) {
            const n = Number(value);
            rowObj[h] = isNaN(n) ? value : n;
            return;
        }
        rowObj[h] = value;
    });
    return rowObj;
}
/**
 * XML 注入器：直接改模板 sheet1.xml + sharedStrings.xml，保全部样式/下拉/主题。
 * 比 exceljs 稳 — exceljs 重排 style 索引导致样式丢失。
 *
 * @param templatePath - 模板 xlsx 路径
 * @param outputPath - 输出 xlsx 路径
 * @param headers - 表头列名（17 列，对应 A-Q）
 * @param rows - 数据行（key=列名，value=单元格值）
 */
function injectTasksToTemplate(templatePath, outputPath, headers, rows) {
    // 1. 拷贝模板 → 输出
    fs_1.default.copyFileSync(templatePath, outputPath);
    const zip = new adm_zip_1.default(outputPath);
    // 2. 解析 sharedStrings，建立 text → index 反查
    const ssXml = zip.readAsText('xl/sharedStrings.xml');
    const ssMatch = ssXml.match(/<sst[^>]*count="(\d+)"\s+uniqueCount="(\d+)"/);
    const strings = [];
    const stringToIndex = {};
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let m;
    let idx = 0;
    while ((m = siRegex.exec(ssXml)) !== null) {
        // 提取 <t>...</t> 文本（合并多段 <t>）
        const textParts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        const text = textParts.map(t => t.replace(/<t[^>]*>/, '').replace(/<\/t>/, '')).join('');
        strings.push(text);
        if (stringToIndex[text] === undefined)
            stringToIndex[text] = idx;
        idx++;
    }
    /** 取/创建 sharedString 索引 */
    const getOrAddString = (text) => {
        if (stringToIndex[text] !== undefined)
            return stringToIndex[text];
        const i = strings.length;
        strings.push(text);
        stringToIndex[text] = i;
        return i;
    };
    /** 列号 → 字母（1 → A，17 → Q） */
    const colLetter = (n) => {
        let s = '';
        while (n > 0) {
            const r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    };
    /** XML 转义 */
    const escapeXml = (s) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    // 3. 生成数据行 XML
    const rowXmlArr = [];
    rows.forEach((row, rIdx) => {
        const rowNum = rIdx + 2; // 从第 2 行开始
        const cells = [];
        headers.forEach((h, cIdx) => {
            const colNum = cIdx + 1;
            const ref = `${colLetter(colNum)}${rowNum}`;
            const val = row[h];
            if (val === undefined || val === null || val === '') {
                // 空单元格不输出（保留下拉验证规则原样）
                return;
            }
            // 数字（工时）
            if (typeof val === 'number' || (/^-?\d+(\.\d+)?$/.test(String(val)) && h.includes('工时'))) {
                cells.push(`<c r="${ref}"><v>${Number(val)}</v></c>`);
                return;
            }
            // 字符串 → sharedString
            const str = String(val);
            const sIdx = getOrAddString(str);
            cells.push(`<c r="${ref}" t="s"><v>${sIdx}</v></c>`);
        });
        if (cells.length > 0) {
            rowXmlArr.push(`<row r="${rowNum}" spans="1:${headers.length}">${cells.join('')}</row>`);
        }
    });
    // 4. 替换 sheet1.xml 的 sheetData
    let sheetXml = zip.readAsText('xl/worksheets/sheet1.xml');
    const newData = `<sheetData><row r="1" ht="18" customHeight="1" spans="1:17">${ /* 保留表头行原样 */''}</row>${rowXmlArr.join('')}</sheetData>`;
    // 提取原表头 row 1 完整内容
    const origRow1Match = sheetXml.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/);
    const origRow1 = origRow1Match ? origRow1Match[0] : '';
    const finalSheetData = `<sheetData>${origRow1}${rowXmlArr.join('')}</sheetData>`;
    sheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, finalSheetData);
    // 更新 dimension
    const lastRow = rows.length + 1;
    sheetXml = sheetXml.replace(/<dimension ref="[^"]*"/, `<dimension ref="A1:Q${lastRow}"`);
    zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf-8'));
    // 5. 更新 sharedStrings
    void ssMatch; // 保留原 count 字段引用
    const newUnique = strings.length;
    const newCount = strings.length; // 简化：count = uniqueCount
    const siBlocks = strings.map(s => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('');
    const newSs = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${newCount}" uniqueCount="${newUnique}">${siBlocks}</sst>`;
    zip.updateFile('xl/sharedStrings.xml', Buffer.from(newSs, 'utf-8'));
    // 6. 写出
    zip.writeZip(outputPath);
}
/**
 * 内存缓存，用于快速访问已生成的计划数据。
 * 数据源为文件持久化存储，缓存缺失时会从文件存储中加载并回填。
 */
const planCache = new lru_cache_js_1.LruCache(50);
/**
 * 跟踪正在生成的 plan 的 AbortController，用于 pause/abort 控制。
 */
const activeGenerations = new Map();
/**
 * 获取计划内存缓存的引用。
 * 主要供 execution 路由模块访问计划数据。
 */
function getPlanStore() {
    return planCache;
}
/**
 * 从缓存或文件存储中查找计划，缓存未命中时自动预热
 * @param taskId - 计划任务ID
 * @param planStore - 文件存储服务实例
 * @returns 计划数据，未找到返回 undefined
 */
function findPlan(taskId, planStore) {
    let plan = planCache.get(taskId);
    if (!plan) {
        plan = planStore.get(taskId);
        if (plan)
            planCache.set(plan.id, plan);
    }
    return plan;
}
/**
 * 同步持久化计划数据到缓存和文件存储
 * @param plan - 计划数据
 * @param planStore - 文件存储服务实例
 */
function persistPlan(plan, planStore) {
    planStore.upsert(plan);
    planCache.set(plan.id, plan);
}
/**
 * 标记计划为失败状态，持久化并广播
 * @param plan - 计划数据
 * @param error - 错误信息
 * @param planStore - 文件存储服务实例
 * @param extraBroadcast - 额外的错误广播消息前缀（可选）
 */
function failPlan(plan, error, planStore, extraBroadcast) {
    plan.status = 'failed';
    plan.error = error;
    plan.updatedAt = new Date().toISOString();
    persistPlan(plan, planStore);
    activeGenerations.delete(plan.id);
    (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: 'failed', error } });
    if (extraBroadcast) {
        (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `${extraBroadcast}: ${error}` } });
    }
}
/**
 * 处理 bridge 成功返回后的状态更新
 * @param plan - 计划数据
 * @param result - bridge 返回结果
 * @param accumulatedOutput - 累积输出文本
 * @param planStore - 文件存储服务实例
 */
function finalizePlan(plan, result, accumulatedOutput, planStore) {
    plan.status = result.exitCode === 0 ? 'ready' : 'failed';
    plan.rawOutput = accumulatedOutput;
    plan.summary = accumulatedOutput.substring(0, 500);
    plan.updatedAt = new Date().toISOString();
    if (result.sessionId)
        plan.sessionId = result.sessionId;
    if (result.exitCode !== 0)
        plan.error = result.stderr || 'Plan generation failed';
    persistPlan(plan, planStore);
    activeGenerations.delete(plan.id);
    (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: plan.status } });
}
/**
 * 从 Pipeline 配置中解析计划阶段的技能列表
 * @param pipelineId - 流水线ID
 * @param pipelineService - 流水线服务实例
 * @returns 技能列表，无配置时返回 undefined
 */
function resolvePlanSkills(pipelineId, pipelineService) {
    if (!pipelineId || !pipelineService)
        return undefined;
    const pipeline = pipelineService.get(pipelineId);
    return pipeline?.steps ? (0, skill_utils_js_1.getPhaseSkills)(pipeline.steps, 'plan') : undefined;
}
/**
 * 获取需求详情：优先从本地 store 读取已保存的版本，避免重新获取导致内容不一致
 * @param requirementId - 需求ID
 * @param reqStore - 本地需求存储服务
 * @param mcpBridgeService - MCP 桥接服务（fallback）
 * @returns 需求的 title 和 description
 */
async function getRequirementContent(requirementId, reqStore, mcpBridgeService) {
    // 优先从本地已保存的需求中取（内容与 Requirements 页面展示一致）
    const saved = reqStore.get(requirementId);
    if (saved) {
        return { title: saved.title, description: saved.description };
    }
    // 本地无缓存，fallback 到 MCP 实时获取
    const detail = await mcpBridgeService.fetchRequirementDetail(requirementId);
    return { title: detail.title, description: detail.description };
}
/**
 * 执行带超时的 bridge 调用，统一处理 onOutput 回调和错误。
 */
async function runBridgeWithTimeout(plan, bridgeOptions, planStore, errorPrefix) {
    let accumulatedOutput = bridgeOptions.accumulatedOutput ?? '';
    const onOutput = (data) => {
        accumulatedOutput += data;
        plan.rawOutput = accumulatedOutput;
        plan.summary = accumulatedOutput.substring(0, 500);
        planCache.set(plan.id, { ...plan });
        (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: data } });
    };
    try {
        const result = await Promise.race([
            bridgeOptions.cliRunner.runBridge({
                prompt: bridgeOptions.prompt,
                cwd: bridgeOptions.cwd,
                sessionId: bridgeOptions.sessionId,
                maxTurns: 20,
                skills: bridgeOptions.skills,
            }, {
                workspacePath: bridgeOptions.cwd,
                signal: bridgeOptions.signal,
                onOutput,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${errorPrefix} timed out after 30 minutes`)), BRIDGE_TIMEOUT_MS)),
        ]);
        finalizePlan(plan, result, accumulatedOutput, planStore);
    }
    catch (err) {
        failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, errorPrefix);
    }
}
/**
 * 按技能顺序串行执行计划生成。
 * - skills 为数组时，依次执行每个技能；每完成一个进入 waiting_skill_confirm，等用户确认。
 * - skills 为 'all' / undefined / 空数组时，单次执行（兼容旧行为）。
 */
async function runPlanSkillsSequentially(plan, opts, planStore) {
    const { cliRunner, prompt, cwd, skills, signal } = opts;
    // 非数组或空数组：单次执行（保持旧行为）
    if (!Array.isArray(skills) || skills.length === 0) {
        await runBridgeWithTimeout(plan, { cliRunner, prompt, cwd, skills, signal }, planStore, 'Plan generation');
        return;
    }
    // 数组：初始化技能队列
    plan.pendingSkills = [...skills];
    plan.executedSkills = [];
    persistPlan(plan, planStore);
    await runNextPlanSkill(plan, { cliRunner, prompt, cwd, signal }, planStore);
}
/**
 * 执行队列中下一个技能。队列空 → 完成。
 * 完成 1 个技能后进入 waiting_skill_confirm，等用户 continue-skill 路由触发下一个。
 */
async function runNextPlanSkill(plan, opts, planStore) {
    const { cliRunner, prompt, cwd, signal } = opts;
    const pending = plan.pendingSkills ?? [];
    if (pending.length === 0) {
        // 全部技能执行完，标记 ready
        plan.status = 'ready';
        plan.currentSkill = undefined;
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        activeGenerations.delete(plan.id);
        (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: plan.status } });
        return;
    }
    // 取出下一个技能
    const skill = pending[0];
    plan.pendingSkills = pending.slice(1);
    plan.currentSkill = skill;
    plan.status = 'generating';
    plan.updatedAt = new Date().toISOString();
    persistPlan(plan, planStore);
    const accumulated = plan.rawOutput ?? '';
    try {
        const result = await Promise.race([
            cliRunner.runBridge({
                prompt,
                cwd,
                sessionId: plan.sessionId,
                maxTurns: 20,
                skills: [skill],
            }, {
                workspacePath: cwd,
                signal,
                onOutput: (data) => {
                    plan.rawOutput = (plan.rawOutput ?? '') + data;
                    plan.summary = (plan.rawOutput ?? '').substring(0, 500);
                    planCache.set(plan.id, { ...plan });
                    (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: data } });
                },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Plan skill "${skill}" timed out after 30 minutes`)), BRIDGE_TIMEOUT_MS)),
        ]);
        if (result.sessionId)
            plan.sessionId = result.sessionId;
        // 当前技能完成 → 加入已执行列表
        plan.executedSkills = [...(plan.executedSkills ?? []), skill];
        plan.currentSkill = undefined;
        if (plan.pendingSkills && plan.pendingSkills.length > 0) {
            // 还有下一个技能 → 等用户确认
            plan.status = 'waiting_skill_confirm';
            plan.updatedAt = new Date().toISOString();
            persistPlan(plan, planStore);
            (0, websocket_js_1.broadcast)({
                type: 'plan:skill_complete',
                data: {
                    taskId: plan.id,
                    completedSkill: skill,
                    nextSkill: plan.pendingSkills[0],
                    pendingCount: plan.pendingSkills.length,
                },
            });
        }
        else {
            // 最后一个技能完成 → ready
            plan.status = 'ready';
            plan.updatedAt = new Date().toISOString();
            persistPlan(plan, planStore);
            activeGenerations.delete(plan.id);
            (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: plan.status } });
        }
    }
    catch (err) {
        failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, `Plan skill "${skill}"`);
    }
}
/**
 * 创建开发计划管理路由
 */
function createPlanRoutes(cliRunnerService, mcpBridgeService, pipelineService, memoryService, mineruService) {
    const planStore = new plan_store_service_js_1.PlanStoreService();
    const reqStore = new requirement_store_service_js_1.RequirementStoreService();
    const router = (0, express_1.Router)();
    // POST /api/plan/generate - 基于需求生成开发计划
    router.post('/generate', (0, validation_js_1.validateBody)([
        { field: 'requirementId', required: true, type: 'string' },
        { field: 'workspacePath', required: true, type: 'string' },
    ]), async (req, res) => {
        const { requirementId, workspacePath, pipelineId, requirementTitle, requirementNumber } = req.body;
        const wsCheck = (0, validation_js_1.validateWorkspacePath)(workspacePath);
        if (!wsCheck.valid) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: wsCheck.error });
            return;
        }
        const taskId = crypto_1.default.randomUUID();
        const planSkills = resolvePlanSkills(pipelineId, pipelineService);
        const plan = {
            id: taskId,
            requirementId,
            requirementTitle,
            requirementNumber,
            workspacePath,
            status: 'generating',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pipelineId,
        };
        persistPlan(plan, planStore);
        res.json({ taskId });
        const abortController = new AbortController();
        activeGenerations.set(taskId, abortController);
        // 异步生成
        try {
            const { title, description } = await getRequirementContent(requirementId, reqStore, mcpBridgeService);
            // 如果 Pipeline 配置了额外文件路径，通过 MinerU 解析后追加到 description
            let enrichedDescription = description;
            if (pipelineId && mineruService?.isEnabled()) {
                const pipeline = pipelineService?.get(pipelineId);
                const docParsing = pipeline?.steps?.documentParsing;
                if (docParsing?.extraPaths && docParsing.extraPaths.length > 0) {
                    const extraMdParts = [];
                    for (const relPath of docParsing.extraPaths) {
                        const fullPath = path_1.default.resolve(workspacePath, relPath);
                        try {
                            const result = await mineruService.parseFile(fullPath);
                            if (result.success && result.markdown) {
                                extraMdParts.push(`### ${relPath}\n\n${result.markdown}`);
                            }
                        }
                        catch { /* 跳过解析失败的文件 */
                        }
                    }
                    if (extraMdParts.length > 0) {
                        enrichedDescription += '\n\n---\n\n## 参考文档\n\n' + extraMdParts.join('\n\n---\n\n');
                    }
                }
            }
            const promptText = PLAN_PROMPT_TEMPLATE
                .replace('{title}', title)
                .replace('{description}', enrichedDescription);
            await runPlanSkillsSequentially(plan, {
                cliRunner: cliRunnerService,
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, workspacePath),
                cwd: workspacePath,
                skills: planSkills,
                signal: abortController.signal,
            }, planStore);
        }
        catch (err) {
            failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Plan generation');
        }
    });
    // GET /api/plan/list - 获取计划列表
    router.get('/list', async (_req, res) => {
        try {
            const plans = (await planStore.list()).map(p => {
                // 迁移：旧 plan 没有 requirementTitle，从 requirement store 补数据
                if (!p.requirementTitle) {
                    try {
                        const req = reqStore.get(p.requirementId);
                        if (req) {
                            p.requirementTitle = req.title;
                            p.requirementNumber = req.number;
                            planStore.upsert(p);
                        }
                    }
                    catch { /* 补数据失败不影响列表返回 */
                    }
                }
                return {
                    id: p.id,
                    requirementId: p.requirementId,
                    requirementTitle: p.requirementTitle,
                    requirementNumber: p.requirementNumber,
                    workspacePath: p.workspacePath,
                    status: p.status,
                    summary: p.summary?.substring(0, 200),
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt,
                };
            });
            res.json(plans);
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/plan/:taskId - 获取计划详情
    router.get('/:taskId', (req, res) => {
        const plan = findPlan(req.params.taskId, planStore);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        // 补数据：缺 requirementNumber 时从 reqStore 查
        if (!plan.requirementNumber && plan.requirementId) {
            try {
                const req = reqStore.get(plan.requirementId);
                if (req) {
                    plan.requirementNumber = req.number;
                    plan.requirementTitle = plan.requirementTitle ?? req.title;
                    planStore.upsert(plan);
                    planCache.set(plan.id, { ...plan });
                }
            }
            catch { /* 补数据失败不影响返回 */
            }
        }
        res.json(plan);
    });
    // PUT /api/plan/:taskId - 更新计划内容
    router.put('/:taskId', (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (req.body.summary !== undefined)
            plan.summary = req.body.summary;
        if (req.body.rawOutput !== undefined)
            plan.rawOutput = req.body.rawOutput;
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        res.json(plan);
    });
    // DELETE /api/plan/:taskId - 删除计划
    router.delete('/:taskId', (req, res) => {
        const deleted = planStore.delete(req.params.taskId);
        planCache.delete(req.params.taskId);
        res.json({ success: deleted });
    });
    // POST /api/plan/:taskId/reply - 多轮对话回复
    router.post('/:taskId/reply', async (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        const { message } = req.body;
        if (!message?.trim()) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
            return;
        }
        if (!plan.sessionId) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No active session to reply to' });
            return;
        }
        res.json({ ok: true });
        plan.status = 'generating';
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: `\n\n**User:** ${message}\n\n` } });
        await runBridgeWithTimeout(plan, {
            cliRunner: cliRunnerService,
            prompt: message,
            cwd: plan.workspacePath,
            sessionId: plan.sessionId,
            accumulatedOutput: plan.rawOutput || '',
        }, planStore, 'Reply');
    });
    // POST /api/plan/:taskId/abort - 取消生成
    router.post('/:taskId/abort', (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        const ac = activeGenerations.get(req.params.taskId);
        if (!ac) {
            failPlan(plan, 'Generation cancelled by user', planStore);
            res.json({ ok: true });
            return;
        }
        ac.abort();
        activeGenerations.delete(req.params.taskId);
        res.json({ ok: true });
    });
    // POST /api/plan/:taskId/pause - 暂停生成
    router.post('/:taskId/pause', (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        const ac = activeGenerations.get(req.params.taskId);
        if (!ac) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No active generation to pause' });
            return;
        }
        res.json({ ok: true });
        ac.abort();
        activeGenerations.delete(req.params.taskId);
        plan.status = 'paused';
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: 'paused' } });
    });
    // POST /api/plan/:taskId/resume - 恢复生成
    router.post('/:taskId/resume', async (req, res) => {
        const plan = findPlan(req.params.taskId, planStore);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (plan.status !== 'paused') {
            res.status(400).json({ code: 'INVALID_STATE', message: 'Plan is not paused' });
            return;
        }
        if (!plan.sessionId) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No session ID available for resume' });
            return;
        }
        const abortController = new AbortController();
        activeGenerations.set(plan.id, abortController);
        plan.status = 'generating';
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: '\n\n[Resuming generation...]\n\n' } });
        res.json({ ok: true });
        await runBridgeWithTimeout(plan, {
            cliRunner: cliRunnerService,
            prompt: 'Continue generating the development plan from where you left off.',
            cwd: plan.workspacePath,
            sessionId: plan.sessionId,
            signal: abortController.signal,
            accumulatedOutput: plan.rawOutput || '',
        }, planStore, 'Resume');
    });
    // POST /api/plan/:taskId/regenerate - 在原 plan 上重新生成
    router.post('/:taskId/regenerate', async (req, res) => {
        const taskId = req.params.taskId;
        const plan = planCache.get(taskId) ?? planStore.get(taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (activeGenerations.has(taskId)) {
            res.status(409).json({ code: 'CONFLICT', message: 'Plan is already generating' });
            return;
        }
        const planSkills = resolvePlanSkills(plan.pipelineId, pipelineService);
        // 重置状态
        plan.status = 'generating';
        plan.rawOutput = undefined;
        plan.summary = undefined;
        plan.error = undefined;
        plan.sessionId = undefined;
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        res.json({ taskId });
        const abortController = new AbortController();
        activeGenerations.set(taskId, abortController);
        try {
            const { title, description } = await getRequirementContent(plan.requirementId, reqStore, mcpBridgeService);
            const promptText = PLAN_PROMPT_TEMPLATE
                .replace('{title}', title)
                .replace('{description}', description);
            await runBridgeWithTimeout(plan, {
                cliRunner: cliRunnerService,
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, plan.workspacePath),
                cwd: plan.workspacePath,
                skills: planSkills,
                signal: abortController.signal,
            }, planStore, 'Plan regeneration');
        }
        catch (err) {
            failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Plan regeneration');
        }
    });
    /**
     * POST /api/plan/:taskId/export-tasks
     * 导出任务拆分 + 工时评估 xlsx。
     * 流程：rawOutput 无 JSON → 先跑 task-breakdown-estimator 技能 → 解析 → 模板填充。
     * @body outputPath - 保存路径（绝对路径），不传则用桌面
     */
    router.post('/:taskId/export-tasks', async (req, res) => {
        try {
            const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
            if (!plan) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
                return;
            }
            // 0. 优先检查 taskBreakdown 字段，其次检查 rawOutput
            let tasks = extractTasksFromOutput(plan.taskBreakdown ?? '') || extractTasksFromOutput(plan.rawOutput ?? '');
            if (!tasks || tasks.length === 0) {
                // 无任务数据，触发 task-breakdown-estimator 技能
                const skillName = 'task-breakdown-estimator';
                const abortController = new AbortController();
                activeGenerations.set(plan.id, abortController);
                // 保存原始开发计划，防止技能输出污染 rawOutput
                const originalRawOutput = plan.rawOutput ?? '';
                const originalSummary = plan.summary ?? '';
                plan.status = 'generating';
                plan.currentSkill = skillName;
                plan.updatedAt = new Date().toISOString();
                persistPlan(plan, planStore);
                try {
                    const { title, description } = await getRequirementContent(plan.requirementId, reqStore, mcpBridgeService);
                    // 给齐技能所需输入（避免技能因追问卡住）
                    const reqId = plan.requirementNumber ?? plan.requirementId;
                    const planContent = plan.rawOutput ?? plan.summary ?? description ?? '';
                    const skillPrompt = `使用 ${skillName} 技能完成需求任务拆分 + 工时评估，按技能 SKILL.md 要求输出完整 17 列 markdown 表格 + 工时汇总 + 风险说明。

【重要】所有输入已提供，禁止追问用户。未知字段填 "—"（除必填：标题、描述、工作项类型="开发"、预估工时、任务拆解类型）。

输入参数：
- 需求号ID：${reqId}
- 需求标题：${title}
- 负责人：—
- 所属项目：根据需求内容从技能 SKILL.md「所属项目 Enum」中自动匹配最接近的值
- 所属产品：根据需求内容从技能 SKILL.md「所属产品 Enum」中自动匹配最接近的值
- 开发主程：—
- 测试主程：—
- 计划周期：— ~ —

需求描述：
${description ?? ''}

开发计划（change points 分析）：
${planContent}

立即输出完整表格，不要追问。`;
                    // 任务拆分使用空输出开始，不污染rawOutput
                    const prevOutput = '';
                    await runBridgeWithTimeout(plan, {
                        cliRunner: cliRunnerService,
                        prompt: (0, prompt_enrichment_js_1.enrichPrompt)(skillPrompt, memoryService, plan.workspacePath),
                        cwd: plan.workspacePath,
                        sessionId: plan.sessionId,
                        skills: [skillName],
                        signal: abortController.signal,
                        accumulatedOutput: prevOutput,
                    }, planStore, 'Task export skill');
                }
                catch (err) {
                    failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Task export skill');
                    res.status(500).json({ code: 'SKILL_FAILED', message: `技能执行失败: ${(0, error_utils_js_1.getErrorMessage)(err)}` });
                    return;
                }
                // 技能跑完后从最新缓存重读
                const refreshed = planCache.get(plan.id) ?? planStore.get(plan.id);
                if (!refreshed) {
                    res.status(500).json({ code: 'EXPORT_ERROR', message: '技能执行后 plan 丢失' });
                    return;
                }
                Object.assign(plan, refreshed);
                // 技能输出当前在 rawOutput（runBridge 写死该字段）→ 挪到 taskBreakdown
                plan.taskBreakdown = plan.rawOutput ?? '';
                // 恢复原始开发计划，保持开发计划与任务拆分彻底分离
                plan.rawOutput = originalRawOutput;
                plan.summary = originalSummary;
                plan.status = 'ready';
                plan.currentSkill = undefined;
                plan.updatedAt = new Date().toISOString();
                persistPlan(plan, planStore);
                tasks = extractTasksFromOutput(plan.taskBreakdown ?? '');
            }
            // 1. 仍无任务数据
            if (!tasks || tasks.length === 0) {
                res.status(400).json({ code: 'NO_TASKS', message: '技能执行后仍未找到任务数据（JSON 或 markdown 表格）' });
                return;
            }
            // 2. 解析模板路径：workspace/templates/ → 内置模板
            const workspaceTemplate = plan.workspacePath
                ? path_1.default.join(plan.workspacePath, 'templates', 'task-split-effort-template.xlsx')
                : null;
            const builtinTemplate = path_1.default.resolve(__dirname, '..', '..', '..', 'templates', 'task-split-effort-template.xlsx');
            const templatePath = (workspaceTemplate && fs_1.default.existsSync(workspaceTemplate)) ? workspaceTemplate : builtinTemplate;
            if (!fs_1.default.existsSync(templatePath)) {
                res.status(500).json({ code: 'TEMPLATE_MISSING', message: `模板不存在: ${templatePath}` });
                return;
            }
            // 3. 用 SheetJS 读下拉枚举（下拉 sheet 无需保样式）
            const wbRaw = xlsx_1.default.readFile(templatePath);
            const dropdowns = parseDropdowns(wbRaw.Sheets['下拉字段']);
            const headerRow = xlsx_1.default.utils.sheet_to_json(wbRaw.Sheets['任务拆解表模版'], { header: 1 })[0];
            const headers = headerRow.map(h => h?.trim() ?? '');
            const ctx = {
                requirementId: plan.requirementNumber ?? plan.requirementId,
                project: '',
                devLead: '',
                testLead: '',
            };
            const rows = tasks.map((t, idx) => buildExportRow(t, idx + 1, headers, dropdowns, ctx));
            // 4. 直接 XML 注入到模板（保样式 + 下拉 + 主题）
            const outputPath = req.body.outputPath?.trim() || path_1.default.join(require('os').homedir(), 'Desktop', `tasks-${plan.id.substring(0, 8)}.xlsx`);
            injectTasksToTemplate(templatePath, outputPath, headers, rows);
            res.json({ success: true, path: outputPath, count: rows.length });
        }
        catch (err) {
            res.status(500).json({ code: 'EXPORT_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * POST /api/plan/:taskId/continue-skill
     * 确认继续执行下一个技能（仅 waiting_skill_confirm 状态可用）
     */
    router.post('/:taskId/continue-skill', async (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (plan.status !== 'waiting_skill_confirm') {
            res.status(400).json({ code: 'INVALID_STATE', message: 'Plan is not waiting for skill confirmation' });
            return;
        }
        if (!plan.pendingSkills || plan.pendingSkills.length === 0) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No pending skills' });
            return;
        }
        res.json({ ok: true });
        // 重建 AbortController
        const abortController = new AbortController();
        activeGenerations.set(plan.id, abortController);
        try {
            const { title, description } = await getRequirementContent(plan.requirementId, reqStore, mcpBridgeService);
            const promptText = PLAN_PROMPT_TEMPLATE
                .replace('{title}', title)
                .replace('{description}', description);
            await runNextPlanSkill(plan, {
                cliRunner: cliRunnerService,
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, plan.workspacePath),
                cwd: plan.workspacePath,
                signal: abortController.signal,
            }, planStore);
        }
        catch (err) {
            failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Continue skill');
        }
    });
    /**
     * POST /api/plan/:taskId/skip-skill
     * 跳过下一个待执行技能
     */
    router.post('/:taskId/skip-skill', async (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (plan.status !== 'waiting_skill_confirm') {
            res.status(400).json({ code: 'INVALID_STATE', message: 'Plan is not waiting for skill confirmation' });
            return;
        }
        // 弹出下一个待执行技能，记录为"已跳过"
        const skipped = plan.pendingSkills?.shift();
        if (skipped) {
            plan.executedSkills = [...(plan.executedSkills ?? []), `${skipped}(skipped)`];
        }
        // 还有剩余技能 → 继续执行下一个；否则完成
        if (plan.pendingSkills && plan.pendingSkills.length > 0) {
            res.json({ ok: true, skipped });
            const abortController = new AbortController();
            activeGenerations.set(plan.id, abortController);
            try {
                const { title, description } = await getRequirementContent(plan.requirementId, reqStore, mcpBridgeService);
                const promptText = PLAN_PROMPT_TEMPLATE
                    .replace('{title}', title)
                    .replace('{description}', description);
                await runNextPlanSkill(plan, {
                    cliRunner: cliRunnerService,
                    prompt: (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, plan.workspacePath),
                    cwd: plan.workspacePath,
                    signal: abortController.signal,
                }, planStore);
            }
            catch (err) {
                failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Skip skill');
            }
        }
        else {
            plan.status = 'ready';
            plan.updatedAt = new Date().toISOString();
            persistPlan(plan, planStore);
            activeGenerations.delete(plan.id);
            (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: plan.status } });
            res.json({ ok: true, skipped, completed: true });
        }
    });
    return router;
}
//# sourceMappingURL=plan.js.map