"use strict";
/**
 * 请求验证与错误处理中间件
 *
 * 提供 Express 请求体验证和全局错误处理功能：
 * - validateBody：基于字段规则校验请求体
 * - errorHandler：捕获未处理异常并返回标准错误响应
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = validateBody;
exports.errorHandler = errorHandler;
exports.validateWorkspacePath = validateWorkspacePath;
const path_1 = __importDefault(require("path"));
/**
 * 请求体验证中间件工厂
 *
 * 根据字段规则数组创建验证中间件。遍历所有规则检查：
 * - 必填字段是否存在（非 undefined/null/空字符串）
 * - 字段类型是否匹配（支持 array 类型检测）
 *
 * 验证失败返回 400 状态码和错误详情数组。
 *
 * @param rules - 字段验证规则数组
 * @returns Express 中间件函数
 *
 * @example
 * app.post('/api/items', validateBody([
 *   { field: 'name', required: true, type: 'string' },
 *   { field: 'count', type: 'number' }
 * ]), handler);
 */
function validateBody(rules) {
    return (req, res, next) => {
        const errors = [];
        for (const rule of rules) {
            const value = req.body?.[rule.field];
            if (rule.required && (value === undefined || value === null || value === '')) {
                errors.push(`Field "${rule.field}" is required`);
                continue;
            }
            if (value !== undefined && value !== null && rule.type) {
                const actualType = Array.isArray(value) ? 'array' : typeof value;
                if (actualType !== rule.type) {
                    errors.push(`Field "${rule.field}" must be of type ${rule.type}, got ${actualType}`);
                }
            }
        }
        if (errors.length > 0) {
            const apiError = {
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                details: errors,
            };
            res.status(400).json(apiError);
            return;
        }
        next();
    };
}
/**
 * 全局错误处理中间件
 *
 * 捕获路由处理中未捕获的异常，返回标准化的 500 错误响应。
 * 必须注册在所有路由之后。
 *
 * @param err - 捕获的错误对象
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 * @param _next - 下一个中间件函数（未使用，Express 签名要求）
 */
function errorHandler(err, _req, res, _next) {
    const apiError = {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred',
    };
    res.status(500).json(apiError);
}
/**
 * workspace 路径安全校验
 *
 * 防止路径遍历攻击，确保路径不是绝对路径或包含 .. 跳转。
 * Daytona 沙箱模式下，路径会在沙箱内解析，此处仅做基本格式校验。
 *
 * @param workspacePath - 待校验的工作区路径
 * @returns 校验结果，valid 为 true 时 path 为规范化后的路径
 */
function validateWorkspacePath(workspacePath) {
    if (!workspacePath) {
        return { valid: false, error: 'workspacePath is required' };
    }
    const trimmed = workspacePath.trim();
    // 防止路径遍历
    if (trimmed.includes('..')) {
        return { valid: false, error: 'workspacePath must not contain path traversal (..)' };
    }
    // 规范化路径
    try {
        const resolved = path_1.default.resolve(trimmed);
        return { valid: true, path: resolved };
    }
    catch {
        return { valid: false, error: 'workspacePath is not a valid path' };
    }
}
//# sourceMappingURL=validation.js.map