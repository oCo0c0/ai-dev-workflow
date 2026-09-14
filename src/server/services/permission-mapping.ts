/**
 * @file permission-mapping.ts
 * @description 全局权限模式到各引擎参数的映射（纯函数）。
 *   claude：confirm 需要确认 UI（onPermissionRequest）才能生效，否则退化为 acceptEdits；
 *   pi：只有 confirm/auto-allow 两档，acceptEdits 视作自动放行。
 */
export type PermissionMode = 'confirm' | 'acceptEdits' | 'bypassPermissions';

export function resolveClaudePermission(
    mode: PermissionMode,
    hasPermissionHandler: boolean,
): {permissionMode: string; permissionEnabled: boolean} {
    if (mode === 'bypassPermissions') {
        return {permissionMode: 'bypassPermissions', permissionEnabled: false};
    }
    if (mode === 'confirm') {
        // confirm 档映射到 Claude CLI 的 default（询问）；无确认 UI 时退化为 acceptEdits
        return hasPermissionHandler
            ? {permissionMode: 'default', permissionEnabled: true}
            : {permissionMode: 'acceptEdits', permissionEnabled: false};
    }
    return {permissionMode: mode, permissionEnabled: hasPermissionHandler};
}

export function resolvePiPermissionMode(mode: PermissionMode, hasPermissionHandler: boolean): 'confirm' | 'auto-allow' {
    return mode === 'confirm' && hasPermissionHandler ? 'confirm' : 'auto-allow';
}
