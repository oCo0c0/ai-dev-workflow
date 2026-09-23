/**
 * @module pi-provider-endpoints
 * @description pi 供应商的探测端点表 —— 仅用于「测试连接」的**只读探测**（GET 模型列表）。
 *
 * 说明：pi 引擎调用模型时的端点由 pi 自己解析（我们只注入凭据），因此这里的信息
 * 不参与执行，只用于在模型供应商页回答一个问题：**这条记录的 key 还有效吗？**
 * 命中内置表用内置端点；记录里填了 Base URL 时以记录为准；都不命中则提示用户填 Base URL。
 */

/** 探测方式：Bearer 头 / x-api-key 头 */
export type PiAuthStyle = 'bearer' | 'x-api-key';

export interface PiEndpoint {
    /** 端点根地址（不含 modelsPath） */
    baseUrl: string;
    /** 模型列表路径（拼在 baseUrl 之后） */
    modelsPath: string;
    auth: PiAuthStyle;
}

/**
 * 内置探测端点（覆盖常用供应商）。
 * 未列出的供应商：请在模型供应商记录里填 Base URL 后即可测试。
 */
export const PI_PROVIDER_ENDPOINTS: Record<string, PiEndpoint> = {
    deepseek: {baseUrl: 'https://api.deepseek.com', modelsPath: '/models', auth: 'bearer'},
    'zai-coding-cn': {baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', modelsPath: '/models', auth: 'bearer'},
    zai: {baseUrl: 'https://api.z.ai/api/paas/v4', modelsPath: '/models', auth: 'bearer'},
    anthropic: {baseUrl: 'https://api.anthropic.com', modelsPath: '/v1/models', auth: 'x-api-key'},
    openai: {baseUrl: 'https://api.openai.com/v1', modelsPath: '/models', auth: 'bearer'},
    moonshot: {baseUrl: 'https://api.moonshot.cn/v1', modelsPath: '/models', auth: 'bearer'},
    kimi: {baseUrl: 'https://api.moonshot.cn/v1', modelsPath: '/models', auth: 'bearer'},
    qwen: {baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelsPath: '/models', auth: 'bearer'},
    'qwen-cn': {baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelsPath: '/models', auth: 'bearer'},
    minimax: {baseUrl: 'https://api.minimax.chat/v1', modelsPath: '/models', auth: 'bearer'},
    xai: {baseUrl: 'https://api.x.ai/v1', modelsPath: '/models', auth: 'bearer'},
    groq: {baseUrl: 'https://api.groq.com/openai/v1', modelsPath: '/models', auth: 'bearer'},
    openrouter: {baseUrl: 'https://openrouter.ai/api/v1', modelsPath: '/models', auth: 'bearer'},
    mistral: {baseUrl: 'https://api.mistral.ai/v1', modelsPath: '/models', auth: 'bearer'},
    together: {baseUrl: 'https://api.together.xyz/v1', modelsPath: '/models', auth: 'bearer'},
    fireworks: {baseUrl: 'https://api.fireworks.ai/inference/v1', modelsPath: '/models', auth: 'bearer'},
    nvidia: {baseUrl: 'https://integrate.api.nvidia.com/v1', modelsPath: '/models', auth: 'bearer'},
};

/**
 * 解析某条 pi 记录的探测端点。
 * @param providerId - provider id（如 deepseek / zai-coding-cn）
 * @param baseUrlOverride - 记录里填写的 Base URL（优先于内置表）
 * @returns 端点信息；无法确定时返回 undefined（前端提示填 Base URL）
 */
export function resolvePiEndpoint(providerId: string, baseUrlOverride?: string): PiEndpoint | undefined {
    const override = baseUrlOverride?.trim();
    if (override) {
        const builtin = PI_PROVIDER_ENDPOINTS[providerId];
        return {
            baseUrl: override.replace(/\/+$/, ''),
            // 记录自填端点：Anthropic 系走 /v1/models，其余按 OpenAI 兼容 /models
            modelsPath: builtin?.modelsPath ?? '/models',
            auth: builtin?.auth ?? 'bearer',
        };
    }
    return PI_PROVIDER_ENDPOINTS[providerId];
}

/** 从记录 id 解析 provider id（`pi:deepseek` → `deepseek`） */
export function piProviderIdOf(recordId: string): string {
    return recordId.startsWith('pi:') ? recordId.slice(3) : recordId;
}
