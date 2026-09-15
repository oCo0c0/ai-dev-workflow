/**
 * @file PanelInput.ts
 * @description 合页（PipelineRunPage）共用输入框的面板协作类型。
 *
 * PlanPanel / ExecutionPanel 通过 ref 暴露 send()，通过 onInputState 回调
 * 向外层上报输入框状态（占位文案/禁用/动作按钮/上下文指示器数据），
 * 外层据此渲染统一的 ChatInputBox。
 */
import type {ReactNode} from 'react';

/** 面板上报的输入框状态 */
export interface PanelInputState {
    placeholder: string;
    disabled: boolean;
    sending: boolean;
    branchWorkspacePath?: string;
    branchDisabled?: boolean;
    /** 输入框右侧动作按钮（暂停/恢复/中止等，由面板状态决定） */
    actions?: ReactNode;
    /** ContextIndicator 的日志（上下文占用提示） */
    contextLogs?: string[];
    onSuggestNewSession?: () => void;
}

/** 面板句柄：外层共用输入框发送时调用 */
export interface PanelHandle {
    send: (text: string, attachmentIds: string[]) => Promise<void> | void;
}
