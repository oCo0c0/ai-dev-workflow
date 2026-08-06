/**
 * @file SetupWizard.tsx
 * @description 首次启动环境检测向导组件 —— 在用户首次使用应用时自动弹出，
 *              依次检测 Claude Code CLI 和 MCP 服务器的连接状态，
 *              并根据检测结果给出相应的环境配置建议。
 *
 * 工作流程：
 * 1. 组件挂载时检查 localStorage 中的完成标记
 * 2. 若未完成过设置，则显示全屏遮罩向导并自动开始环境检测
 * 3. 依次执行两步检测：Claude Code CLI 可用性 -> MCP 服务器连接状态
 * 4. 检测完成后展示结果摘要，用户点击"Complete Setup"关闭向导
 * 5. 完成标记写入 localStorage，后续访问不再弹出
 *
 * @exports SetupWizard - 默认导出的环境检测向导组件
 * @exports SystemStatus - 系统状态接口类型（文件内部使用）
 * @exports SetupStep - 向导步骤类型（文件内部使用）
 */

import {useState, useEffect} from 'react';
import {apiGet} from '../api';

/**
 * 系统状态响应数据接口
 *
 * 对应后端 `/system/status` API 接口返回的数据结构，
 * 用于描述当前系统的各项环境配置状态。
 *
 * @property claudeCodeAvailable - Claude Code CLI 是否可用
 * @property claudeCodeVersion    - Claude Code CLI 的版本号（可选）
 * @property mcpServers           - MCP 服务器列表，每项包含名称和连接状态
 * @property configPath           - 配置文件的文件系统路径
 * @property uptime               - 后端服务运行时长（秒）
 */
interface SystemStatus {
    claudeCodeAvailable: boolean;
    claudeCodeVersion?: string;
    mcpServers: { name: string; status: string }[];
    configPath: string;
    uptime: number;
}

/**
 * 向导当前步骤的联合类型
 *
 * - checking-cli: 正在检测 Claude Code CLI 可用性
 * - checking-mcp: 正在检测 MCP 服务器连接状态
 * - complete:     所有检测完成，展示结果摘要
 * - error:        检测过程中发生错误
 */
type SetupStep = 'checking-cli' | 'checking-mcp' | 'complete' | 'error';

/**
 * localStorage 中用于标记向导是否已完成的键名
 * 当该键存在时，后续访问将不再弹出设置向导
 */
const SETUP_FLAG = 'ai-workbench-setup-complete';

/**
 * 环境检测向导主组件
 *
 * 以全屏遮罩弹窗的形式展示，仅在用户首次使用时出现。
 * 组件内部管理检测步骤的状态机，按顺序完成 CLI 和 MCP 的检测。
 *
 * @component
 * @returns {JSX.Element | null} 向导可见时返回弹窗 DOM，不可见时返回 null
 */
export default function SetupWizard() {
    /** 控制向导弹窗是否可见 */
    const [visible, setVisible] = useState(false);
    /** 当前检测步骤，驱动 UI 展示不同的状态 */
    const [step, setStep] = useState<SetupStep>('checking-cli');
    /** Claude Code CLI 是否可用 */
    const [cliAvailable, setCliAvailable] = useState(false);
    /** 是否至少有一个 MCP 服务器已连接 */
    const [mcpConnected, setMcpConnected] = useState(false);
    /** 检测过程中捕获的错误信息 */
    const [error, setError] = useState<string | null>(null);

    /**
     * 组件挂载时检查是否已完成过初始化设置
     *
     * 通过读取 localStorage 中的 SETUP_FLAG 标记来判断：
     * - 若标记不存在，说明是首次使用，显示向导并启动环境检测
     * - 若标记已存在，说明已完成过设置，向导保持隐藏状态
     */
    useEffect(() => {
        const setupComplete = localStorage.getItem(SETUP_FLAG);
        if (!setupComplete) {
            setVisible(true);
            checkSystem();
        }
    }, []);

    /**
     * 执行系统环境检测的异步函数
     *
     * 检测流程：
     * 1. 将步骤设为 'checking-cli'，清除之前的错误状态
     * 2. 调用 `/system/status` API 获取系统状态
     * 3. 检查 Claude Code CLI 是否可用
     * 4. 将步骤推进到 'checking-mcp'
     * 5. 遍历 MCP 服务器列表，判断是否存在至少一个已连接的服务器
     * 6. 所有检测完成后将步骤设为 'complete'
     * 7. 若 API 请求失败，捕获错误并将步骤设为 'error'
     */
    async function checkSystem() {
        setStep('checking-cli');
        setError(null);

        try {
            const status = await apiGet<SystemStatus>('/system/status');
            setCliAvailable(status.claudeCodeAvailable);

            setStep('checking-mcp');
            // 检查是否存在至少一个状态为 'connected' 的 MCP 服务器
            const hasConnectedMcp = status.mcpServers.some((s) => s.status === 'connected');
            setMcpConnected(hasConnectedMcp);

            setStep('complete');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to check system status');
            setStep('error');
        }
    }

    /**
     * 完成设置处理函数
     *
     * 将完成标记写入 localStorage 以便下次访问时跳过向导，
     * 然后隐藏向导弹窗。
     */
    function handleComplete() {
        localStorage.setItem(SETUP_FLAG, 'true');
        setVisible(false);
    }

    // 向导不可见时不渲染任何 DOM
    if (!visible) return null;

    return (
        <>
            {/* 全屏遮罩层：半透明黑色背景 + 模糊效果，阻止用户与底层页面交互 */}
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                {/* 向导主面板卡片 */}
                <div className="w-full max-w-md glass-panel rounded-xl p-6 shadow-xl">
                    <h2 className="mb-4 text-xl font-semibold text-foreground">
                        Welcome to AI Dev Workbench
                    </h2>
                    <p className="mb-6 text-sm text-muted-foreground">
                        Let's verify your environment is ready.
                    </p>

                    {/* 第一步：Claude Code CLI 可用性检测 */}
                    <div className="mb-4 flex items-center gap-3">
                        <StatusIcon
                            status={
                                step === 'checking-cli'
                                    ? 'loading'
                                    : cliAvailable
                                        ? 'success'
                                        : 'warning'
                            }
                        />
                        <div>
                            <p className="text-sm font-medium text-foreground">Claude Code CLI</p>
                            {/* 根据当前步骤和检测结果动态显示不同的描述文本 */}
                            <p className="text-xs text-muted-foreground">
                                {step === 'checking-cli'
                                    ? 'Checking availability...'
                                    : cliAvailable
                                        ? 'Available and ready'
                                        : 'Not found — install Claude Code CLI to enable AI features'}
                            </p>
                        </div>
                    </div>

                    {/* 第二步：MCP 服务器连接状态检测 */}
                    <div className="mb-4 flex items-center gap-3">
                        <StatusIcon
                            status={
                                // CLI 检测阶段 MCP 步骤显示为 pending（等待中）
                                step === 'checking-cli'
                                    ? 'pending'
                                    // MCP 检测进行中
                                    : step === 'checking-mcp'
                                        ? 'loading'
                                        // 至少一个 MCP 服务器已连接
                                        : mcpConnected
                                            ? 'success'
                                            // 没有任何 MCP 服务器连接
                                            : 'warning'
                            }
                        />
                        <div>
                            <p className="text-sm font-medium text-foreground">MCP Connection</p>
                            <p className="text-xs text-muted-foreground">
                                {step === 'checking-cli' || step === 'checking-mcp'
                                    ? 'Checking MCP server status...'
                                    : mcpConnected
                                        ? 'Connected to MCP server'
                                        : 'No MCP server connected — configure in MCP panel'}
                            </p>
                        </div>
                    </div>

                    {/* 错误状态展示：仅在检测失败时显示，并提供重试按钮 */}
                    {step === 'error' && error && (
                        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                            <p className="text-sm text-destructive">{error}</p>
                            <button
                                onClick={checkSystem}
                                className="mt-2 text-xs text-destructive underline hover:opacity-80"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {/* 检测完成后的结果摘要：根据 CLI 和 MCP 的可用性组合展示不同提示 */}
                    {step === 'complete' && (
                        <div className="mb-4 rounded-lg border border-border bg-accent/40 p-3">
                            <p className="text-sm text-foreground/90">
                                {cliAvailable && mcpConnected
                                    ? '✅ Everything looks good! You are ready to start.'
                                    : !cliAvailable && !mcpConnected
                                        ? '⚠️ Claude Code CLI and MCP are not configured. Some features will be limited.'
                                        : !cliAvailable
                                            ? '⚠️ Claude Code CLI not found. AI coding features will be unavailable.'
                                            : '⚠️ No MCP server connected. Requirements fetching will be unavailable.'}
                            </p>
                        </div>
                    )}

                    {/* 操作按钮区域：仅在所有检测完成后显示"Complete Setup"按钮 */}
                    <div className="flex justify-end gap-3">
                        {step === 'complete' && (
                            <button
                                onClick={handleComplete}
                                className="rounded-lg brand-gradient px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 transition-all"
                            >
                                Complete Setup
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

/**
 * 状态图标子组件 —— 根据传入的状态类型渲染不同的视觉指示器
 *
 * 四种状态对应四种视觉表现：
 * - pending:  空心圆圈（○），表示尚未开始
 * - loading:  旋转的加载动画，表示正在检测中
 * - success:  绿色对勾（✓），表示检测通过
 * - warning:  黄色警告（⚠），表示检测未通过但非致命
 *
 * @param props.status - 当前状态类型
 * @returns {JSX.Element} 对应状态的图标元素
 */
function StatusIcon({status}: { status: 'pending' | 'loading' | 'success' | 'warning' }) {
    switch (status) {
        case 'pending':
            return <span className="flex h-5 w-5 items-center justify-center text-muted-foreground">○</span>;
        case 'loading':
            return (
                <span className="flex h-5 w-5 items-center justify-center">
          {/* 使用 CSS border 动画模拟旋转加载效果：主色圆环 + 顶部透明实现缺口旋转 */}
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"/>
        </span>
            );
        case 'success':
            return <span className="flex h-5 w-5 items-center justify-center text-green-400">✓</span>;
        case 'warning':
            return <span className="flex h-5 w-5 items-center justify-center text-yellow-400">⚠</span>;
    }
}
