/**
 * @module prompt-enrichment
 * @description Prompt 增强工具
 *
 * 将记忆系统的上下文信息注入到原始 prompt 中，
 * 使 AI 执行时能感知用户偏好和项目特征。
 * 注入的上下文限制在 500 字符以内，避免 token 浪费。
 */
import type {MemoryService} from '../services/memory/memory-service.js';

/** 上下文增强块的最大字符数 */
const MAX_ENRICHMENT_LENGTH = 500;

/**
 * 增强 prompt：在原始 prompt 前注入记忆上下文
 *
 * @param originalPrompt - 原始 prompt 文本
 * @param memoryService - 记忆服务实例（可选，undefined 时直接返回原始 prompt）
 * @param workspacePath - 工作空间路径
 * @returns 增强后的 prompt，或原始 prompt（无可用记忆时）
 */
export function enrichPrompt(
    originalPrompt: string,
    memoryService: MemoryService | undefined,
    workspacePath: string,
): string {
    if (!memoryService) return originalPrompt;

    const enrichment = memoryService.buildContextEnrichment(workspacePath);
    if (!enrichment) return originalPrompt;

    // 截断过长的增强内容
    const truncated = enrichment.length > MAX_ENRICHMENT_LENGTH
        ? enrichment.substring(0, MAX_ENRICHMENT_LENGTH) + '...'
        : enrichment;

    return `## Learned Context\n${truncated}\n\n## Task\n${originalPrompt}`;
}
