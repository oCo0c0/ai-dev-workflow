/**
 * @file Button 按钮组件
 *
 * @description
 * 基于class-variance-authority (CVA) 实现的可复用按钮(Button)组件。
 * 提供多种视觉变体（默认、破坏性、轮廓、次要、幽灵、链接）和尺寸选项
 * （默认、小号、大号、图标），并支持通过 `asChild` 属性将按钮语义
 * 转移至子元素（利用 Radix UI 的 Slot 组件）。
 *
 * @example
 * ```tsx
 * // 基础用法
 * <Button>点击按钮</Button>
 *
 * // 变体与尺寸
 * <Button variant="destructive" size="sm">删除</Button>
 *
 * // 作为子元素渲染（渲染为 Link 组件但保持按钮样式）
 * <Button asChild>
 *   <a href="/home">返回首页</a>
 * </Button>
 * ```
 */

import * as React from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '../../lib/utils';

/**
 * 按钮组件的样式变体与尺寸定义
 *
 * 使用 CVA（class-variance-authority）库管理不同变体和尺寸下的 CSS 类名映射。
 * 所有变体共享基础样式：行内弹性布局、居中对齐、不换行文本、圆角、
 * 中号字体以及禁用状态下的透明度与指针事件禁用。
 *
 * 可用变体（variant）：
 * - `default`     — 主色调背景，带阴影，悬停时降低透明度
 * - `destructive` — 危险色调背景，带小阴影，用于删除/重置等操作
 * - `outline`     — 边框轮廓样式，背景透明，悬停时显示强调色
 * - `secondary`   — 次要色调背景，带小阴影，用于辅助操作
 * - `ghost`       — 无边框无背景，悬停时显示强调色，用于工具栏等场景
 * - `link`        — 链接样式，主色调文字带下划线偏移，悬停时显示下划线
 *
 * 可用尺寸（size）：
 * - `default` — 标准高度(36px)，标准内边距
 * - `sm`      — 小号高度(32px)，紧凑内边距，小号字体
 * - `lg`      — 大号高度(40px)，宽内边距，适合主要操作按钮
 * - `icon`    — 正方形(36px)，适合纯图标按钮
 */
const buttonVariants = cva(
    'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
    {
        variants: {
            variant: {
                /** 默认变体：品牌渐变背景（跟随主题 accent）+ 阴影，悬停时加深 */
                default: 'brand-gradient text-primary-foreground border-0 shadow-sm hover:shadow-md hover:opacity-90',
                /** 破坏性变体：危险色调背景 + 前景色 + 小阴影，用于不可逆操作 */
                destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
                /** 轮廓变体：带边框 + 背景色 + 小阴影，悬停时显示强调色 */
                outline: 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
                /** 次要变体：次要色调背景 + 前景色 + 小阴影，用于辅助操作 */
                secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
                /** 幽灵变体：无边框无背景，悬停时显示强调色，常用于工具栏按钮 */
                ghost: 'hover:bg-accent/60 hover:text-accent-foreground',
                /** 链接变体：主色调文字 + 下划线偏移，悬停时显示下划线，模拟超链接样式 */
                link: 'text-primary underline-offset-4 hover:underline',
            },
            size: {
                /** 默认尺寸：高度36px，水平内边距16px */
                default: 'h-9 px-4 py-2',
                /** 小号尺寸：高度32px，紧凑内边距，小号字体 */
                sm: 'h-8 rounded-lg px-3 text-xs',
                /** 大号尺寸：高度40px，宽内边距，适合页面主要操作 */
                lg: 'h-10 rounded-xl px-8',
                /** 图标尺寸：正方形36px，仅容纳单个图标 */
                icon: 'h-9 w-9',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
);

/**
 * Button 按钮组件的属性接口
 *
 * 继承自原生 HTMLButtonElement 的所有属性，同时通过 VariantProps
 * 获得由 CVA 定义的可选 `variant` 和 `size` 属性。
 *
 * @extends React.ButtonHTMLAttributes<HTMLButtonElement>
 * @extends VariantProps<typeof buttonVariants>
 *
 * @property asChild - 当设置为 true 时，按钮不会渲染为 `<button>` 元素，
 *   而是将所有 props（包括样式、事件等）合并到唯一的子元素上。
 *   这允许将按钮样式应用于 `<a>`、`<RouterLink>` 等其他元素，
 *   同时保持语义正确性和无障碍访问支持。底层由 Radix UI 的 Slot 组件实现。
 */
export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

/**
 * Button 按钮组件
 *
 * 通用按钮组件，支持多种视觉变体、尺寸以及多态渲染。
 * 使用 `React.forwardRef` 实现引用转发，便于与表单库或动画库集成。
 *
 * @param props - ButtonProps，包含 variant、size、asChild、className 及其他原生 button 属性
 * @param ref   - 转发到渲染元素的 ref 引用
 * @returns 渲染后的按钮元素或 Slot 包装的子元素
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({className, variant, size, asChild = false, ...props}, ref) => {
        // 当 asChild 为 true 时，使用 Radix UI 的 Slot 组件代替原生 button 元素，
        // 将所有属性合并到子元素上，实现多态渲染
        const Comp = asChild ? Slot : 'button';
        return (
            <Comp
                className={cn(buttonVariants({variant, size, className}))}
                ref={ref}
                {...props}
            />
        );
    }
);
Button.displayName = 'Button';

export {Button, buttonVariants};
