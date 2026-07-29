import type {Step} from 'react-joyride';

/**
 * 页面引导步骤配置
 *
 * 每个页面的步骤通过 data-tour 属性定位元素
 * placement 根据布局调整：左侧栏用 right，右侧用 left，顶部用 bottom
 * content 支持 ReactNode，可嵌入图片
 */

export interface GuideConfig {
    /** 页面唯一标识，用于 localStorage 持久化 */
    pageKey: string;
    /** 引导步骤 */
    steps: Step[];
}

export const guideConfigs: Record<string, GuideConfig> = {
    requirements: {
        pageKey: 'requirements',
        steps: [
            {
                target: '[data-tour="req-fetch-input"]',
                content: '在这里输入需求 ID、编号（如 #125975）或 ONES 链接，从 ONES 等平台获取需求详情。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="req-search-btn"]',
                content: '点击搜索按钮，通过 MCP 关键词搜索跨平台需求。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="req-saved-list"]',
                content: '已保存的需求会显示在此列表中，点击查看详情。这些需求可以在流水线中使用。',
                placement: 'right',
            },
        ],
    },
    workspace: {
        pageKey: 'workspace',
        steps: [
            {
                target: '[data-tour="ws-add-btn"]',
                content: '点击添加工作区，选择本地项目目录。系统会自动检测项目类型。',
                placement: 'right',
            },
            {
                target: '[data-tour="ws-list"]',
                content: '工作区列表。点击工作区浏览文件和查看 Git 状态。',
                placement: 'right',
            },
            {
                target: '[data-tour="ws-files-tab"]',
                content: '文件标签页 — 浏览项目目录树，点击文件预览内容。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="ws-changes-tab"]',
                content: '变更标签页 — 查看已修改、新增、删除的文件和 diff。',
                placement: 'bottom',
            },
        ],
    },
    pipelines: {
        pageKey: 'pipelines',
        steps: [
            {
                target: '[data-tour="pipe-new-btn"]',
                content: '新建流水线，定义开发工作流：需求来源、工作区、技能配置、测试策略。',
                placement: 'right',
            },
            {
                target: '[data-tour="pipe-list"]',
                content: '流水线列表。点击编辑配置，点击 Run 启动执行向导。',
                placement: 'right',
            },
            {
                target: '[data-tour="pipe-editor"]',
                content: '编辑器 — 配置需求来源、工作区绑定、各阶段技能、MCP 工具和测试策略。',
                placement: 'left',
            },
        ],
    },
    plan: {
        pageKey: 'plan',
        steps: [
            {
                target: '[data-tour="plan-generate-btn"]',
                content: '选择需求和工作区后，点击生成计划。CLI 工具会分析项目代码并生成结构化开发计划。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="plan-content"]',
                content: '生成的计划内容。你可以编辑调整步骤后再执行。',
                placement: 'top',
            },
            {
                target: '[data-tour="plan-confirm-btn"]',
                content: '确认计划后点击此按钮，进入代码执行阶段。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="plan-reply-area"]',
                content: '生成过程中可与 CLI 工具多轮对话，补充要求或回答问题。',
                placement: 'top',
            },
        ],
    },
    execution: {
        pageKey: 'execution',
        steps: [
            {
                target: '[data-tour="exec-output"]',
                content: '终端输出区 — 实时显示 CLI 工具执行每个步骤的日志。',
                placement: 'top',
            },
            {
                target: '[data-tour="exec-controls"]',
                content: '控制按钮：暂停、重试、跳过、终止。随时控制执行流程。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="exec-reply"]',
                content: '回复区域 — CLI 工具执行中如有提问，在此回复。',
                placement: 'top',
            },
        ],
    },
    tests: {
        pageKey: 'tests',
        steps: [
            {
                target: '[data-tour="test-detect-btn"]',
                content: '检测按钮 — 自动扫描项目使用的测试框架。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="test-mode-selector"]',
                content: '测试模式：运行现有测试 / AI 编写测试 / AI E2E 测试。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="test-run-btn"]',
                content: '选择模式后点击运行，测试结果将显示在下方。',
                placement: 'bottom',
            },
        ],
    },
    projects: {
        pageKey: 'projects',
        steps: [
            {
                target: '[data-tour="proj-workspace-list"]',
                content: '选择工作区查看多任务看板。',
                placement: 'right',
            },
            {
                target: '[data-tour="proj-new-task-btn"]',
                content: '新建任务 — 选择需求、流水线、基础分支，可设置前置依赖实现任务编排。',
                placement: 'bottom',
            },
            {
                target: '[data-tour="proj-kanban"]',
                content: '看板视图 — 运行中、排队中、已完成。点击卡片查看详情。',
                placement: 'top',
            },
        ],
    },
    skills: {
        pageKey: 'skills',
        steps: [
            {
                target: '[data-tour="skill-new-btn"]',
                content: '新建技能。技能是 Markdown 指令模板，可以在流水线阶段中引用。',
                placement: 'right',
            },
            {
                target: '[data-tour="skill-list"]',
                content: '技能列表。点击查看或编辑技能内容。',
                placement: 'right',
            },
        ],
    },
    mcp: {
        pageKey: 'mcp',
        steps: [
            {
                target: '[data-tour="mcp-add-btn"]',
                content: '添加 MCP 服务器 — 扩展 CLI 工具的能力，连接外部数据源。',
                placement: 'right',
            },
            {
                target: '[data-tour="mcp-server-list"]',
                content: '已配置的服务器列表。点击 Test 验证连接是否正常。',
                placement: 'right',
            },
        ],
    },
    mineru: {
        pageKey: 'mineru',
        steps: [
            {
                target: '[data-tour="mineru-upload"]',
                content: '拖拽或点击上传文件。支持 PDF、DOCX、PPTX、XLSX 和图片。',
                placement: 'right',
            },
            {
                target: '[data-tour="mineru-parse-btn"]',
                content: '上传文件后点击解析，AI 提取结构化 Markdown 内容。',
                placement: 'right',
            },
            {
                target: '[data-tour="mineru-results"]',
                content: '解析结果预览区。支持 Markdown 渲染和原始文本两种视图。',
                placement: 'left',
            },
        ],
    },
};

/** 检查页面引导是否已看过 */
export function isGuideSeen(pageKey: string): boolean {
    try {
        return localStorage.getItem(`guide_${pageKey}_seen`) === 'true';
    } catch {
        return false;
    }
}

/** 标记页面引导已看过 */
export function markGuideSeen(pageKey: string): void {
    try {
        localStorage.setItem(`guide_${pageKey}_seen`, 'true');
    } catch { /* */ }
}
