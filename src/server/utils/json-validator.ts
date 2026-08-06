/**
 * @module json-validator
 * @description 手写轻量 JSON 结构校验器（纯函数，不依赖 zod/ajv）。
 *
 * 用于校验 LLM 结构化输出：返回可读错误列表（形如 `subTasks[0].title: 必填 string`），
 * 可直接拼进纠错 prompt 让 LLM 重新输出。
 */

export type FieldSpec =
    | {type: 'string'; required?: boolean; minLength?: number; maxLength?: number}
    | {type: 'number'; required?: boolean; min?: number; max?: number}
    | {type: 'boolean'; required?: boolean}
    | {type: 'array'; required?: boolean; item?: FieldSpec; minItems?: number; maxItems?: number}
    | {type: 'enum'; values: readonly string[]; required?: boolean}
    | {type: 'object'; required?: boolean; fields?: Record<string, FieldSpec>};

export interface ValidationResult {
    ok: boolean;
    /** ok 时的校验对象 */
    value?: Record<string, unknown>;
    /** 错误列表，如 ["subTasks[0].title: 必填 string"] */
    errors: string[];
}

function describeType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

/** 校验单个字段（顶层字段与数组元素共用） */
function validateField(value: unknown, spec: FieldSpec, path: string, errors: string[]): void {
    if (value === undefined || value === null) {
        if (spec.required) errors.push(`${path}: 必填 ${spec.type}`);
        return;
    }

    switch (spec.type) {
        case 'string': {
            if (typeof value !== 'string') {
                errors.push(`${path}: 应为 string，实际 ${describeType(value)}`);
                break;
            }
            if (spec.minLength !== undefined && value.length < spec.minLength) {
                errors.push(`${path}: 长度需 >= ${spec.minLength}`);
            }
            if (spec.maxLength !== undefined && value.length > spec.maxLength) {
                errors.push(`${path}: 长度需 <= ${spec.maxLength}`);
            }
            break;
        }
        case 'number': {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                errors.push(`${path}: 应为 number，实际 ${describeType(value)}`);
                break;
            }
            if (spec.min !== undefined && value < spec.min) errors.push(`${path}: 需 >= ${spec.min}`);
            if (spec.max !== undefined && value > spec.max) errors.push(`${path}: 需 <= ${spec.max}`);
            break;
        }
        case 'boolean': {
            if (typeof value !== 'boolean') {
                errors.push(`${path}: 应为 boolean，实际 ${describeType(value)}`);
            }
            break;
        }
        case 'enum': {
            if (!spec.values.includes(value as never)) {
                errors.push(`${path}: 应为 ${spec.values.join(' | ')} 之一，实际 ${String(value)}`);
            }
            break;
        }
        case 'array': {
            if (!Array.isArray(value)) {
                errors.push(`${path}: 应为 array，实际 ${describeType(value)}`);
                break;
            }
            if (spec.minItems !== undefined && value.length < spec.minItems) {
                errors.push(`${path}: 至少 ${spec.minItems} 项`);
            }
            if (spec.maxItems !== undefined && value.length > spec.maxItems) {
                errors.push(`${path}: 至多 ${spec.maxItems} 项`);
            }
            if (spec.item) {
                value.forEach((item, i) => validateField(item, spec.item as FieldSpec, `${path}[${i}]`, errors));
            }
            break;
        }
        case 'object': {
            if (typeof value !== 'object' || Array.isArray(value)) {
                errors.push(`${path}: 应为 object，实际 ${describeType(value)}`);
                break;
            }
            validateFields(value as Record<string, unknown>, spec.fields ?? {}, path, errors);
            break;
        }
    }
}

function validateFields(
    value: Record<string, unknown>,
    fields: Record<string, FieldSpec>,
    path: string,
    errors: string[],
): void {
    for (const [key, fieldSpec] of Object.entries(fields)) {
        const childPath = path ? `${path}.${key}` : key;
        validateField(value[key], fieldSpec, childPath, errors);
    }
}

/**
 * 校验一个对象是否符合字段规格。
 *
 * @param value - 待校验值（应为对象）
 * @param spec - 字段规格表（顶层键 → FieldSpec）
 * @returns ok=true 且带 value；失败返回错误列表
 */
export function validateShape(value: unknown, spec: Record<string, FieldSpec>): ValidationResult {
    const errors: string[] = [];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {ok: false, errors: [`顶层应为 object，实际 ${describeType(value)}`]};
    }
    validateFields(value as Record<string, unknown>, spec, '', errors);
    return errors.length === 0
        ? {ok: true, value: value as Record<string, unknown>, errors: []}
        : {ok: false, errors};
}
