/**
 * @file paw-side.ts
 * @description 键位 → 猫爪映射（Bongo Cat 输入镜像）
 *
 * 按物理键盘左右分区：左手区（QWERT 行左半、ASDF 行左半、ZXCV 行左半、
 * 数字 1-5、左侧修饰键）→ 左爪；其余 → 右爪；空格/未知键 → 按 parity 交替。
 * 注意：src/electron/main.ts 的 before-input-event 转发持有一份同逻辑副本
 * （主进程不能 import client 代码），改动两处需同步。
 */

/** 左手区键位（event.code） */
const LEFT_ZONE = /^(Digit[1-5]|Key[QWERTASDFGZXCB]|ShiftLeft|ControlLeft|AltLeft|MetaLeft|Backquote|Tab|CapsLock|F[1-6])$/;

/** 纯修饰键（不触发敲击） */
const MODIFIER_ONLY = /^(Shift|Control|Alt|Meta)(Left|Right)$/;

/**
 * 键位映射到猫爪
 * @param code   KeyboardEvent.code / Electron input.code
 * @param parity 未知键位的交替开关（调用方自增）
 */
export function pawSideOfCode(code: string, parity: boolean): 'left' | 'right' {
    if (LEFT_ZONE.test(code)) return 'left';
    if (code.startsWith('Key') || code.startsWith('Digit')) return 'right';
    return parity ? 'left' : 'right';
}

/** 是否为纯修饰键（Shift/Ctrl/Alt/Meta 单按不敲） */
export function isModifierOnly(code: string): boolean {
    return MODIFIER_ONLY.test(code);
}
