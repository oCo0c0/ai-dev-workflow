/**
 * @file Badge 徽章组件
 *
 * @description
 * 基于class-variance-authority (CVA) 实现的可复用徽章(Badge)组件。
 * 提供多种预定义的视觉变体（默认、次要、危险、轮廓、成功、警告），
 * 适用于状态标签、分类标记、通知提示等场景。
 *
 * @example
 * ```tsx
 * // 基础用法
 * <Badge>默认徽章</Badge>
 *
 * // 指定变体
 * <Badge variant="success">已完成</Badge>
 * <Badge variant="warning">待处理</Badge>
 * ```
 */

import * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '../../lib/utils';

/**
 * 徽章组件的样式变体定义
 *
 * 使用 CVA（class-variance-authority）库管理不同变体下的 CSS 类名映射。
 * 所有变体共享基础样式：行内弹性布局、圆角边框、紧凑内边距、
 * 小号加粗字体以及焦点状态下的轮廓环效果。
 *
 * 可用变体：
 * - `default`   — 主色调背景，带阴影，用于一般标记
 * - `secondary` — 次要色调背景，用于辅助信息展示
 * - `destructive` — 危险色调背景，带阴影，用于错误或删除标记
 * - `outline`   — 无背景色，仅保留边框与前景色，用于轻量标记
 * - `success`   — 翡翠绿半透明背景与文字，用于成功状态
 * - `warning`   — 琥珀色半透明背景与文字，用于警告状态
 */
const badgeVariants = cva(
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-2',
    {
        variants: {
            variant: {
                /** 默认变体：主色调背景 + 前景色 + 阴影 */
                default: 'border-transparent bg-primary text-primary-foreground shadow',
                /** 次要变体：次要色调背景 + 前景色，无边框阴影 */
                secondary: 'border-transparent bg-secondary text-secondary-foreground',
                /** 危险变体：破坏性色调背景 + 前景色 + 阴影，用于警告/错误场景 */
                destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
                /** 轮廓变体：仅保留前景色，通过边框勾勒轮廓，适合轻量使用 */
                outline: 'text-foreground',
                /** 成功变体：翡翠绿半透明背景与文字，用于表示成功/通过状态 */
                success: 'border-transparent bg-emerald-500/15 text-emerald-500',
                /** 警告变体：琥珀色半透明背景与文字，用于表示注意/待处理状态 */
                warning: 'border-transparent bg-amber-500/15 text-amber-500',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    }
);

/**
 * Badge 徽章组件的属性接口
 *
 * 继承自原生 HTMLDivElement 的所有属性，同时通过 VariantProps
 * 获得由 CVA 定义的可选 `variant` 变体属性。
 *
 * @extends React.HTMLAttributes<HTMLDivElement>
 * @extends VariantProps<typeof badgeVariants>
 */
export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof badgeVariants> {
}

/**
 * Badge 徽章组件
 *
 * 用于展示小型状态标签或分类标记的 UI 组件。根据传入的 `variant` 属性
 * 自动应用对应的视觉样式，支持通过 `className` 进行自定义样式扩展。
 *
 * @param props - BadgeProps，包含 variant、className 及其他原生 div 属性
 * @returns 渲染后的徽章 div 元素
 */
function Badge({className, variant, ...props}: BadgeProps) {
    return <div className={cn(badgeVariants({variant}), className)} {...props} />;
}

export {Badge, badgeVariants};
