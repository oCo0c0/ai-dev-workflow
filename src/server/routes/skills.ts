/**
 * @file skills.ts
 * @description 技能（Skills）路由模块
 *
 * 本模块定义了与 AI 技能相关的 RESTful API 路由，提供技能的增删改查（CRUD）功能。
 * 技能是系统中可复用的提示词模板或能力单元，供 Claude 在对话中调用。
 *
 * 路由前缀：/api/skills
 *
 * 端点列表：
 * - GET    /              获取所有技能列表
 * - GET    /:name         根据名称获取技能详情
 * - POST   /              创建新技能
 * - PUT    /:name         更新指定技能
 * - DELETE /:name         删除指定技能
 */

import {Router} from 'express';
import fs from 'fs';
import path from 'path';
import {SkillsService} from '../services/skills-service.js';
import type {CLIRunnerService} from '../services/cli-runner-service.js';
import type {SkillDerivationService} from '../services/skill-derivation-service.js';
import type {SkillInfo} from '../services/cli-providers';
import {validateBody} from '../middleware/validation.js';
import {getErrorMessage} from '../utils/error-utils.js';
import {extractDescription} from '../utils/markdown-utils.js';

/** 内置技能目录（项目 skills/ → dist/skills/） */
const BUILTIN_SKILLS_DIR = path.resolve(__dirname, '..', '..', '..', 'skills');

/** 加载内置技能（5 个默认） */
function loadBuiltinSkills(): SkillInfo[] {
    const out: SkillInfo[] = [];
    if (!fs.existsSync(BUILTIN_SKILLS_DIR)) return out;
    try {
        for (const entry of fs.readdirSync(BUILTIN_SKILLS_DIR, {withFileTypes: true})) {
            if (!entry.isDirectory()) continue;
            const mdPath = path.join(BUILTIN_SKILLS_DIR, entry.name, 'SKILL.md');
            if (!fs.existsSync(mdPath)) continue;
            try {
                const content = fs.readFileSync(mdPath, 'utf-8');
                out.push({
                    name: entry.name,
                    description: extractDescription(content),
                    enabled: true,
                    filePath: mdPath,
                    source: 'builtin',
                });
            } catch { /* skip */ }
        }
    } catch { /* ignore */ }
    return out;
}

/**
 * 创建技能路由实例
 */
export function createSkillsRoutes(
    skillsService: SkillsService,
    cliRunnerService: CLIRunnerService,
    skillDerivationService?: SkillDerivationService,
): Router {
    const router = Router();

    // GET /api/skills - 获取所有技能列表（内置 + provider 合并，去重，内置优先）
    router.get('/', async (_req, res) => {
        try {
            const builtin = loadBuiltinSkills();
            const provider = cliRunnerService.getProvider();
            const external = await provider.loadSkills();
            // 标记外部来源
            const externalMarked = external.map(s => ({...s, source: s.source ?? 'external'}));

            // 合并去重：内置优先，外部同名跳过
            const seen = new Set(builtin.map(s => s.name));
            const merged = [...builtin, ...externalMarked.filter(s => !seen.has(s.name))];
            res.json(merged);
        } catch (err) {
            res.status(500).json({code: 'SKILLS_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/skills/:name - 根据名称获取技能详情
    router.get('/:name', async (req, res) => {
        try {
            const name = req.params.name;
            // 1. 先查用户自建/个人技能（commands/skills 目录）
            const skill = skillsService.get(name);
            if (skill) {
                res.json(skill);
                return;
            }
            // 2. fallback：从 provider 扫描结果（含插件/命令）按 name 匹配，读 filePath 返回内容
            const provider = cliRunnerService.getProvider();
            const external = await provider.loadSkills();
            const hit = external.find(s => s.name === name);
            if (hit) {
                let content = '';
                try {
                    content = fs.readFileSync(hit.filePath, 'utf-8');
                } catch { /* 读不到返回空内容 */
                }
                res.json({
                    name: hit.name,
                    description: hit.description,
                    enabled: true,
                    filePath: hit.filePath,
                    source: hit.source ?? 'external',
                    content,
                });
                return;
            }
            res.status(404).json({code: 'NOT_FOUND', message: `Skill "${name}" not found`});
        } catch (err) {
            res.status(500).json({code: 'SKILLS_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/skills - 创建新技能
    // 请求体需包含 name（技能名称）和 content（技能内容）两个必填字段
    router.post('/', validateBody([
        {field: 'name', required: true, type: 'string'},
        {field: 'content', required: true, type: 'string'},
    ]), (req, res) => {
        try {
            const {name, content} = req.body;
            const skill = skillsService.create(name, content);
            // 创建成功返回 201 Created 状态码
            res.status(201).json(skill);
        } catch (err) {
            // 创建失败通常是因为业务校验不通过（如名称冲突），返回 400
            res.status(400).json({code: 'SKILLS_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/skills/derive - 从 analytics 执行证据手动提炼技能（LLM 驱动）
    router.post('/derive', validateBody([
        {field: 'analyticsIds', required: true, type: 'array'},
    ]), async (req, res) => {
        try {
            if (!skillDerivationService) {
                res.status(500).json({code: 'SKILLS_ERROR', message: 'skillDerivationService 未装配'});
                return;
            }
            const {analyticsIds, workspacePath, pattern} = req.body as {
                analyticsIds: string[];
                workspacePath?: string;
                pattern?: 'recovery-insight' | 'repeated-failure' | 'skill-ineffective';
            };
            if (analyticsIds.length === 0) {
                res.status(400).json({code: 'INVALID_BODY', message: 'analyticsIds 不能为空数组'});
                return;
            }
            const result = await skillDerivationService.deriveFromAnalytics(analyticsIds, workspacePath, pattern);
            if (!result.ok) {
                // 找不到证据记录按 404，提炼失败按 422（区别于业务校验）
                const status = result.error?.includes('未找到可用的执行证据') ? 404 : 422;
                res.status(status).json({code: 'DERIVE_FAILED', message: result.error});
                return;
            }
            res.json({ok: true, skillName: result.skillName});
        } catch (err) {
            res.status(500).json({code: 'SKILLS_ERROR', message: getErrorMessage(err)});
        }
    });

    // PUT /api/skills/:name - 更新指定技能的内容
    // 仅更新 content 字段，技能名称（URL 路径参数）不可更改
    router.put('/:name', validateBody([
        {field: 'content', required: true, type: 'string'},
    ]), (req, res) => {
        try {
            const skill = skillsService.update(req.params.name, req.body.content);
            res.json(skill);
        } catch (err) {
            res.status(400).json({code: 'SKILLS_ERROR', message: getErrorMessage(err)});
        }
    });

    // DELETE /api/skills/:name - 删除指定技能
    router.delete('/:name', (req, res) => {
        try {
            const deleted = skillsService.delete(req.params.name);
            if (!deleted) {
                // 尝试删除不存在的技能时返回 404
                res.status(404).json({code: 'NOT_FOUND', message: `Skill "${req.params.name}" not found`});
                return;
            }
            res.json({success: true});
        } catch (err) {
            res.status(500).json({code: 'SKILLS_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
