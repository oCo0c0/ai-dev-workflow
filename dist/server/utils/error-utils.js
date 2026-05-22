"use strict";
/**
 * @module error-utils
 * @description 错误处理工具函数
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getErrorMessage = getErrorMessage;
/**
 * 从 unknown 类型的错误中提取可读的错误消息
 *
 * TypeScript catch 块中的 err 是 unknown 类型，通常需要 `(err as Error).message`。
 * 此函数提供类型安全的替代方案。
 *
 * @param err - catch 块中捕获的错误
 * @returns 错误消息字符串
 */
function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=error-utils.js.map