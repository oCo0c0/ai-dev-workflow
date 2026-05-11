/**
 * @file 全局键盘快捷键 Hook
 * @description 提供 React Hook，用于注册和管理全局键盘快捷键。
 *              支持通过 Ctrl + 数字键在各功能模块间快速切换，
 *              以及通过 Ctrl + 字母键触发常用操作（生成计划、确认执行、运行测试等）。
 *              当焦点位于输入框或文本编辑区域时，字母键快捷键会被自动屏蔽，
 *              避免与用户正常输入冲突。
 */

import {useEffect} from 'react';
import {useNavigate} from 'react-router-dom';

/**
 * 快捷键路由映射表
 *
 * 将 Ctrl+1 ~ Ctrl+8 依次映射到应用的各个功能页面。
 * 数组索引与数字键一一对应：索引 0 对应 Ctrl+1，以此类推。
 */
const sectionRoutes = [
    '/',           // Ctrl+1: 需求管理
    '/workspace',  // Ctrl+2: 工作空间
    '/plan',       // Ctrl+3: 开发计划
    '/execution',  // Ctrl+4: 执行监控
    '/tests',      // Ctrl+5: 测试结果
    '/skills',     // Ctrl+6: 技能管理
    '/mcp',        // Ctrl+7: MCP 配置
    '/pipelines',  // Ctrl+8: 工作流管道
];

/**
 * 键盘快捷键处理器接口
 * @description 定义可通过快捷键触发的回调函数，各字段均为可选。
 */
export interface KeyboardShortcutHandlers {
    /** Ctrl+G: 触发 AI 计划生成 */
    onGeneratePlan?: () => void;
    /** Ctrl+Enter: 确认执行当前计划 */
    onConfirmExecution?: () => void;
    /** Ctrl+T: 运行测试套件 */
    onRunTests?: () => void;
}

/**
 * 全局键盘快捷键 Hook
 *
 * 注册的快捷键列表:
 *   - Ctrl+1 ~ Ctrl+8: 跳转到对应的功能页面
 *   - Ctrl+G:          触发计划生成（输入框内不触发）
 *   - Ctrl+Enter:      确认执行计划
 *   - Ctrl+T:          运行测试（输入框内不触发）
 *
 * 注意事项:
 *   - 仅响应 Ctrl 键组合，忽略 Alt / Meta 键组合以避免与系统快捷键冲突
 *   - 当焦点在 INPUT / TEXTAREA / contentEditable 元素上时，字母键快捷键不会触发
 *   - 组件卸载时自动移除事件监听器，防止内存泄漏
 *
 * @param handlers - 可选的快捷键回调处理器
 */
export function useKeyboardShortcuts(handlers?: KeyboardShortcutHandlers) {
    const navigate = useNavigate();

    useEffect(() => {
        /**
         * 全局键盘按下事件处理器
         * @param e - 原生键盘事件对象
         */
        function handleKeyDown(e: KeyboardEvent) {
            // 仅处理 Ctrl 组合键，忽略 Alt / Meta 组合（避免与系统快捷键冲突）
            if (!e.ctrlKey || e.altKey || e.metaKey) return;

            // 检测当前焦点是否位于可输入元素中
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            // Ctrl+1 ~ Ctrl+8: 跳转到对应的功能页面
            const numKey = parseInt(e.key, 10);
            if (numKey >= 1 && numKey <= 8) {
                e.preventDefault();
                navigate(sectionRoutes[numKey - 1]);
                return;
            }

            // Ctrl+G: 触发计划生成（输入框内不触发，避免影响正常输入）
            if (e.key === 'g' || e.key === 'G') {
                if (isInput) return;
                e.preventDefault();
                handlers?.onGeneratePlan?.();
                return;
            }

            // Ctrl+Enter: 确认执行（在任何元素上均可触发）
            if (e.key === 'Enter') {
                e.preventDefault();
                handlers?.onConfirmExecution?.();
                return;
            }

            // Ctrl+T: 运行测试（输入框内不触发，避免影响正常输入）
            if (e.key === 't' || e.key === 'T') {
                if (isInput) return;
                e.preventDefault();
                handlers?.onRunTests?.();
                return;
            }
        }

        // 注册全局键盘事件监听
        window.addEventListener('keydown', handleKeyDown);
        // 组件卸载时移除监听器，防止内存泄漏
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigate, handlers]);
}
