/**
 * @file controls.tsx
 * @description 快捷设置面板共享控件 —— 行语法/胶囊开关/accent 填充滑杆/分区标题
 *
 * 行语法（对齐 dsh-wallpaper-engine 设置页）：左「标签 + 一句话说明」右控件，
 * 长说明收进 title tooltip。原内联于 WallpaperSection，抽出自供六页签复用。
 */
import {type ReactNode} from 'react';
import {cn} from '../../lib/utils';

/** 设置行：左标签(+一句话说明)，右控件 */
export function Row({label, hint, tooltip, children}: {
    label: string;
    hint?: string;
    tooltip?: string;
    children: ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-2">
            <div className="min-w-0">
                <p className="text-sm font-medium" title={tooltip}>{label}</p>
                {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
    );
}

/** 胶囊开关（原生 checkbox 视觉隐藏，焦点环落在轨道上，键盘可达） */
export function Toggle({checked, onChange, label}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
}) {
    return (
        <label className="relative inline-block cursor-pointer">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={label}
                className="peer sr-only"
            />
            <span
                className={cn(
                    'block h-5 w-9 rounded-full transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                    checked ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                        checked && 'translate-x-4'
                    )}
                />
            </span>
        </label>
    );
}

/** accent 填充滑杆行（轨道左段走主色，macOS/Linear 质感） */
export function SliderRow({label, hint, min, max, step, value, onChange, format}: {
    label: string;
    hint?: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
    format: (v: number) => string;
}) {
    const fill = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    return (
        <div className="py-1.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{label}</p>
                <span className="text-xs tabular-nums text-muted-foreground">{format(value)}</span>
            </div>
            <input
                type="range"
                className="wp-slider w-full"
                min={min}
                max={max}
                step={step}
                value={value}
                aria-label={label}
                style={{'--wp-fill': `${fill}%`} as React.CSSProperties}
                onChange={(e) => onChange(Number(e.target.value))}
            />
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

/** 分区标题（页签内的小节） */
export function SectionTitle({title, desc}: {title: string; desc?: string}) {
    return (
        <div className="mb-1">
            <p className="text-sm font-semibold">{title}</p>
            {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
        </div>
    );
}

/** 二选一段控件（主题/语言等） */
export function SegmentedControl<T extends string>({value, options, onChange}: {
    value: T;
    options: Array<{value: T; label: string}>;
    onChange: (v: T) => void;
}) {
    return (
        <div className="flex w-full rounded-lg border border-border/60 p-0.5">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        value === opt.value
                            ? 'bg-accent text-accent-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
