---
name: task-breakdown-estimator
description: "Decompose software requirements into granular tasks with typed categories and realistic effort estimates. Designed to run AFTER a development plan skill has analyzed all change points. Produces a structured markdown table covering frontend, backend, data engineering, testing, and other task types with hour-level estimation including self-test, integration testing, and edge-case coverage. Estimates assume manual coding with no AI-assisted development shortcuts. This skill should be used when a developer needs to break down a requirement into actionable sub-tasks with effort estimates for project planning, sprint planning, or workload assessment. Triggers on phrases like task breakdown, effort estimation, decompose requirement, 工时评估, 任务拆分."
---

# Task Breakdown & Effort Estimator

## Purpose

Break a requirement into atomic, typed sub-tasks and estimate realistic effort (hours) for each.
Estimates assume the developer writes all code manually, including self-testing, integration
testing, environment configuration, and edge-case handling — everything up to submitting to the
test environment.

## Prerequisites

Before running this skill, confirm the following inputs are available (ask the user if missing):

1. **Requirement ID** — the ticket / requirement number.
2. **Development plan** — a completed analysis of all change points (from a prior planning skill or manual input).
3. **Assignee** — developer name(s) responsible.
4. **Project / Product** — owning project and product names.
5. **Lead developer / Lead tester** — names of the requirement leads.
6. **Planning date range** — start and end dates for the development cycle.

If a prior planning skill produced a plan document, read it first to extract all change points.

## Task Decomposition Categories

Use ONLY the categories listed below. Each decomposed task must map to exactly one category.

### Frontend (前端)

| Code | Category (EN) | Category (ZH) |
|------|---------------|---------------|
| FE-UI | Frontend UI Modification | 前端-界面修改 |
| FE-PAGE | Frontend New Page/Form | 前端-新增页面/表单 |
| FE-COMP | Frontend New Component | 前端-新增组件 |
| FE-CHART | Frontend Charts/Dashboard | 前端-图表/大屏 |
| FE-ADAPT | Frontend Mobile/Theme/i18n | 前端-移动端/主题/国际化适配 |

### Backend (后端)

| Code | Category (EN) | Category (ZH) |
|------|---------------|---------------|
| BE-CRUD | Backend New CRUD Module | 后端-新增CRUD模块 |
| BE-BIZ-NEW | Backend New Business Logic | 后端-新增业务逻辑 |
| BE-BIZ-MOD | Backend Modify Business Logic | 后端-调整业务逻辑 |
| BE-BATCH | Backend Scheduled Task/Batch | 后端-定时任务/批处理 |
| BE-MQ | Backend Message Queue | 后端-消息队列 |
| BE-API-NEW | Backend New API (Provider) | 后端-新增接口（提供方） |
| BE-API-CONSUME | Backend Consume External API | 后端-调用外部接口（消费方） |
| BE-API-MOD | Backend Modify Existing API | 后端-修改已有接口 |
| BE-QRY-NEW | Backend New Query API | 后端-新增查询接口 |
| BE-QRY-MOD | Backend Modify Query API | 后端-修改查询接口 |
| BE-3RD | Backend Third-Party API Integration | 后端-三方API集成 |
| BE-FLOW-NEW | Backend New Workflow | 后端-新增流程 |
| BE-FLOW-MOD | Backend Workflow Adjustment | 后端-流程调整 |
| BE-PERM | Backend Permission/Menu Config | 后端-权限/菜单配置 |
| BE-IMP-NEW | Backend New Import | 后端-新增导入 |
| BE-IMP-MOD | Backend Modify Import | 后端-修改导入 |
| BE-EXP-NEW | Backend New Export | 后端-新增导出 |
| BE-EXP-MOD | Backend Modify Export | 后端-修改导出 |
| BE-DATA | Backend Data Processing | 后端-数据处理 |
| BE-RPT-STAT | Backend Report Statistics | 后端-报表统计 |
| BE-RPT-ANALYSIS | Backend Report Analysis | 后端-报表分析 |
| BE-RPT-CHANGE | Backend Report Change | 后端-报表变更 |

### Data Engineering (数开)

| Code | Category (EN) | Category (ZH) |
|------|---------------|---------------|
| DE-ODS | Data Engineering ODS | 数开-ODS |
| DE-DWD | Data Engineering DWD | 数开-DWD |
| DE-DWS | Data Engineering DWS | 数开-DWS |
| DE-ADS | Data Engineering ADS | 数开-ADS |
| DE-SCHED | Data Engineering Scheduling | 数开-调度管理 |
| DE-QUALITY | Data Engineering Data Quality | 数开-数据质量 |
| DE-DIM | Data Engineering Dimension Modeling | 数开-维度建模 |
| DE-IND | Data Engineering Indicator Development | 数开-指标开发 |
| DE-CHANGE | Data Engineering Change Optimization | 数开-变更优化 |

### Testing (测试)

| Code | Category (EN) | Category (ZH) |
|------|---------------|---------------|
| TEST-CASE | Test Case Related | 测试用例相关 |
| TEST-R1 | Round 1 Testing | 一轮测试 |
| TEST-R2 | Round 2 Testing | 二轮测试 |

### Other (其他)

| Code | Category (EN) | Category (ZH) |
|------|---------------|---------------|
| OTHER-RES | Research | 调研 |
| OTHER-DESIGN | Technical Solution Design | 技术方案设计 |

## Effort Estimation Rules

Estimates must account for ALL work a developer performs before handing off to QA.

### Included in Every Estimate

1. **Code implementation** — writing production code.
2. **Unit testing** — writing and passing local tests.
3. **Self-testing / debugging** — running the feature locally, fixing bugs found.
4. **Integration testing** — verifying integration with upstream/downstream systems.
5. **Edge-case handling** — null checks, boundary conditions, error paths.
6. **Code review preparation** — cleaning up, adding comments, ensuring style compliance.
7. **Environment configuration** — config files, property changes, feature toggles.
8. **Documentation** — inline comments, API docs if applicable.

### Estimation Heuristics

Read `references/estimation_guide.md` for detailed per-category multipliers. Key principles:

- **Minimum granularity**: 0.5 hour (30 min). Anything smaller merges into a related task.
- **Typical ranges** per complexity（任务复杂度列填对应中文档位）:
  - **简单** (simple config, field addition, minor UI tweak): 0.5 – 2 h
  - **中等** (new CRUD, API with 3–5 fields, standard form): 2 – 8 h
  - **复杂** (complex business logic, multi-table operations, workflow, new module, system integration): 8 – 40 h
- **Self-test overhead**: add 20–30% on top of pure coding time.
- **Integration overhead**: add 15–25% if cross-module or cross-system interaction.
- **Unknowns**: if a task has >30% uncertainty, flag it and add a 50% buffer.

### Complexity Assessment

Rate each task and write the **中文** label to the 任务复杂度 column: `简单` | `中等` | `复杂`.

Factors:
- Number of database tables touched
- Number of external systems involved
- Business rule complexity
- Data volume / performance requirements
- Reuse of existing patterns vs. novel implementation

## Output Format — MANDATORY

**CRITICAL: The output table is the primary deliverable of this skill. It MUST be rendered in full every time.**

**STRICT RULES — VIOLATION = SKILL FAILURE:**

1. **ALWAYS output the FULL 17-column table** with these exact headers (in this exact order):

```
| 需求号ID | 任务ID | 标题 | 描述 | 负责人 | 状态 | 所属项目 | 所属产品 | 工作项类型 | 优先级 | 预估工时(h) | 计划开始 | 计划完成 | 任务拆解类型 | 任务复杂度 | 开发主程 | 测试主程 |
```

2. **NEVER output a simplified/abbreviated table.** The following formats are FORBIDDEN:
   - 3-column summary tables (任务 | 类型 | 工作量)
   - Tables missing any of the 17 required columns
   - Plain text task lists without the full table

3. **EVERY row must have the "任务拆解类型" column filled** with a value from the category table (use the ZH label, e.g., `后端-新增接口（提供方）`, `前端-界面修改`). NEVER use generic labels like "修改", "新增", "验证", "配置", "协调".

4. **For fields not yet provided by the user, fill with `—`** (em dash). Do NOT omit columns.

5. After the table, ALWAYS include the 工时汇总 and 风险与说明 sections.

### Field Reference

| # | Column Header | Filled By | Default / Notes |
|---|--------------|-----------|-----------------|
| 1 | 需求号ID | User input | Required |
| 2 | 任务ID | User input | Optional, fill `—` if none |
| 3 | 标题 | Skill generates | Concise, action-oriented |
| 4 | 描述 | Skill generates | 1–2 sentences, scope + acceptance |
| 5 | 负责人 | User input | Fill `—` if unknown |
| 6 | 状态 | Auto | `未开始` |
| 7 | 所属项目 | Skill auto-matches | MUST pick closest value from `所属项目` enum below based on requirement analysis. If truly unknown, fill `—` |
| 8 | 所属产品 | Skill auto-matches | MUST pick closest value from `所属产品` enum below based on requirement analysis. If truly unknown, fill `—` |
| 9 | 工作项类型 | Auto | `任务` |
| 10 | 优先级 | Skill assigns | `P0` / `P1` / `P2` / `P3` |
| 11 | 预估工时(h) | Skill estimates | Number, 0.5h minimum, round to 0.5h |
| 12 | 计划开始 | User input or derived | `YYYY-MM-DD` format |
| 13 | 计划完成 | User input or derived | `YYYY-MM-DD` format |
| 14 | 任务拆解类型 | Skill assigns | MUST use ZH label from category table |
| 15 | 任务复杂度 | Skill assesses | `简单` / `中等` / `复杂` |
| 16 | 开发主程 | User input | Fill `—` if unknown |
| 17 | 测试主程 | User input | Fill `—` if unknown |

### 所属项目 Enum (所属项目 — MUST pick closest match)

Skill MUST analyze requirement content (title, description, change points) and pick the closest matching project from this list. If truly uncertain, fill `—`.

- Wondersign
- 数据分析支持
- NOBLE HOME系统（NH)
- 质检系统（QC）
- 公共服务项目
- 车队系统（LM Lastmile）
- 核算系统（FAS）
- 自营产品ERP
- 客服邮件系统(CSMS)
- 财务系统
- 海运系统（MMS）
- 报销系统(FNS)
- B2B gigacloudlogistics
- 单点登录系统（CAS）
- 第三方物流系统（3PL)
- 仓储作业系统（WMS)
- 订单发货系统（DRP)
- CASH
- 自动化测试平台Apifox
- 泛微合同管理系统集成项目
- 数仓建设
- 线下业务

### 所属产品 Enum (所属产品 — MUST pick closest match)

Skill MUST analyze requirement content and pick the closest matching product from this list. If truly uncertain, fill `—`.

- 资金中台
- CASH
- RPA
- 数仓报表
- 架构优化
- Wondersign
- CMS
- 质检APP
- 其它业财
- Seller ERP系统
- Shopify App
- Onsite系统
- B2B后台管理系统
- 通用仓储系统（欧洲+日本）
- OHUB
- Tracking
- 数据分析支持
- EBS
- 公共服务
- 亚马逊授权服务（SP API）
- 质检系统（QC）
- NOBLE HOME系统（NH）
- 云仓中间层（GCW）
- 核算系统（FAS）
- 在库系统（OSJ）
- 供应链管理系统(SCM)
- 财务数据平台（FDP）
- 报销系统（FNS）
- 分单服务
- 物流中心
- 公司官网
- B2B平台
- 车队系统（Last Mile）
- 海运系统（MMS）
- 日本仓储作业系统（JP_WMS）
- 德国仓储作业系统（DE_WMS）
- 英国仓储作业系统（UK_WMS）
- 美国仓储系统
- 在库发货模块
- 单点登录系统（CAS）
- 云送仓（CDW）
- 运费管理系统（FMS）
- 合同管理系统（CMS）
- 客服邮件系统(CSMS)
- 基础服务系统（DRP_TOOL)
- 打印宝系统(DrpPrintPal)
- 日本DRP
- 欧洲DRP
- 美国DRP
- 第三方物流系统（3PL）

### Auto-Match Logic for 所属项目 / 所属产品

1. Read requirement title + description + plan content.
2. Match keywords / domain terms against enum labels above.
3. If a clear match exists (e.g., requirement mentions "DRP订单" → `订单发货系统（DRP)`), use that value.
4. If ambiguous, pick the closest by domain proximity.
5. If no reasonable match, fill `—` (do NOT invent values outside the enum).

### Complete Output Template (copy this structure exactly)

```markdown
## 任务拆分与工时评估

**需求号**: {{req_id}}
**需求标题**: {{req_title}}
**负责人**: {{assignee}}
**所属项目**: {{project}} | **所属产品**: {{product}}
**开发主程**: {{lead_dev}} | **测试主程**: {{lead_tester}}
**计划周期**: {{start_date}} ~ {{end_date}}

| 需求号ID | 任务ID | 标题 | 描述 | 负责人 | 状态 | 所属项目 | 所属产品 | 工作项类型 | 优先级 | 预估工时(h) | 计划开始 | 计划完成 | 任务拆解类型 | 任务复杂度 | 开发主程 | 测试主程 |
|---------|--------|------|------|--------|------|---------|---------|-----------|--------|------------|---------|---------|------------|-----------|---------|---------|
| {{req_id}} | — | Task title here | Task description here | {{assignee}} | 未开始 | {{project}} | {{product}} | 任务 | P1 | 2.0 | {{start}} | {{end}} | 后端-新增接口（提供方） | 中等 | {{lead_dev}} | {{lead_tester}} |
| {{req_id}} | — | Next task title | Next description | {{assignee}} | 未开始 | {{project}} | {{product}} | 任务 | P2 | 1.0 | {{start}} | {{end}} | 前端-界面修改 | 简单 | {{lead_dev}} | {{lead_tester}} |

### 工时汇总

| 类别 | 任务数 | 总工时(h) |
|------|--------|----------|
| 前端 | x | xx.x |
| 后端 | x | xx.x |
| 数开 | x | xx.x |
| 测试 | x | xx.x |
| 其他 | x | xx.x |
| **合计** | **x** | **xx.x** |

### 风险与说明

- (List any tasks with high uncertainty, dependencies, or external blockers)
```

## Workflow

### Step 1 — Gather Inputs

Collect requirement ID, change-point list, assignee, project/product, leads, and date range.
If a prior planning skill produced output, read it now.

### Step 2 — Decompose Tasks

For each change point, create one or more atomic tasks:
- Each task maps to exactly one category from the category table.
- Task title: concise, action-oriented (e.g., "Add AR invoice list query API").
- Task description: 1–2 sentences covering scope and acceptance criteria.
- Avoid tasks larger than 24h — split into sub-tasks if needed.

### Step 3 — Estimate Effort

For each task:
1. Assess complexity (简单 / 中等 / 复杂).
2. Apply estimation heuristics from `references/estimation_guide.md`.
3. Include self-test + integration overhead.
4. Round to nearest 0.5h.
5. If uncertainty >30%, flag in risk section.

### Step 4 — Assign Priority

- `P0`: Blocker / critical path
- `P1`: High priority, needed for core flow
- `P2`: Standard priority
- `P3`: Nice-to-have / low urgency

### Step 5 — Generate Output Table

Render the full table using the output template. Append summary and risk sections.

### Step 6 — Review with User

Present the table. Ask:
1. Are any tasks missing or incorrectly scoped?
2. Do the effort estimates feel realistic?
3. Any dependencies or sequencing constraints to note?

Revise based on feedback.

## Resources

### references/

- `references/estimation_guide.md` — Detailed per-category estimation baselines and multipliers.
