/**
 * @file API 请求封装模块
 * @description 封装与后端 REST API 通信的通用 HTTP 请求函数。
 *              所有请求均以 `/api` 为基础路径，提供 GET / POST / PUT / DELETE
 *              四种标准方法的类型安全封装，并统一处理错误响应。
 *              此外还包含一个调用系统原生文件夹选择对话框的特殊接口。
 */

/** 后端 API 基础路径前缀 */
const API_BASE = '/api';

/**
 * 发送 GET 请求
 * @template T - 响应数据的类型
 * @param path - 请求路径（相对于 API_BASE）
 * @returns 解析后的 JSON 响应数据
 * @throws 当 HTTP 状态码非 2xx 时，抛出包含后端错误信息的 Error
 */
export async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error((await res.json()).message || res.statusText);
    return res.json();
}

/**
 * 发送 POST 请求
 * @template T - 响应数据的类型
 * @param path - 请求路径（相对于 API_BASE）
 * @param body - 可选的请求体数据，为 undefined 时不发送 body
 * @returns 解析后的 JSON 响应数据
 * @throws 当 HTTP 状态码非 2xx 时，抛出包含后端错误信息的 Error
 */
/** HTTP 错误，携带状态码 + 后端响应体 */
export class ApiError extends Error {
    status: number;
    body: Record<string, unknown>;

    constructor(status: number, body: Record<string, unknown>) {
        super((body.message as string) || `HTTP ${status}`);
        this.status = status;
        this.body = body;
    }
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errBody);
    }
    return res.json();
}

/**
 * 发送 PUT 请求
 * @template T - 响应数据的类型
 * @param path - 请求路径（相对于 API_BASE）
 * @param body - 请求体数据（必填）
 * @returns 解析后的 JSON 响应数据
 * @throws 当 HTTP 状态码非 2xx 时，抛出包含后端错误信息的 Error
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).message || res.statusText);
    return res.json();
}

/**
 * 发送 DELETE 请求
 * @param path - 请求路径（相对于 API_BASE）
 * @throws 当 HTTP 状态码非 2xx 时，抛出包含后端错误信息的 Error
 */
export async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`${API_BASE}${path}`, {method: 'DELETE'});
    if (!res.ok) throw new Error((await res.json()).message || res.statusText);
}

/**
 * 通过后端打开系统原生的文件夹选择对话框
 *
 * 该接口将请求转发至 Electron/Tauri 等桌面框架或后端服务，
 * 调用操作系统的文件夹选取 API，返回用户选择的路径。
 *
 * @param title - 可选的对话框标题，默认为 "Select Folder"
 * @returns 用户选择的文件夹路径；若用户取消选择则返回 null
 */
export async function pickFolder(title?: string): Promise<string | null> {
    const res = await fetch('/api/workspace/pick', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: title || 'Select Folder'}),
    });
    // 请求失败（如用户取消）时返回 null，而非抛出异常
    if (!res.ok) return null;
    const data = await res.json();
    return data.path ?? null;
}
