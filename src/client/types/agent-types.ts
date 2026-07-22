/** Agent 执行相关共享类型 */

import type {
    ExecutionStep,
    SubTask,
    AgentThought,
    AgentExecutionSummary,
    AgentExecution,
} from '../../types/agent-execution';

export type {
    ExecutionStep,
    SubTask,
    AgentThought,
    AgentExecutionSummary,
    AgentExecution,
};

export type ExecutionStatus = AgentExecutionSummary['status'];

/** 前端使用的 AgentExecution 详情别名，与后端 AgentExecution 完全一致 */
export type AgentExecutionDetail = AgentExecution;
