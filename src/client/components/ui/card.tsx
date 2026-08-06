/**
 * @file Card 卡片组件
 *
 * @description
 * 可复用的卡片(Card)容器组件集合，采用组合模式设计。
 * 由 Card（容器）、CardHeader（头部）、CardTitle（标题）、
 * CardDescription（描述）、CardContent（内容区）和 CardFooter（底部）
 * 六个子组件构成，适用于信息展示、数据面板、设置表单等场景。
 *
 * 所有子组件均使用 `React.forwardRef` 实现引用转发，
 * 并通过 `cn` 工具函数支持自定义 className 的合并扩展。
 *
 * @example
 * ```tsx
 * <Card>
 *   <CardHeader>
 *     <CardTitle>卡片标题</CardTitle>
 *     <CardDescription>卡片描述信息</CardDescription>
 *   </CardHeader>
 *   <CardContent>
 *     <p>卡片正文内容</p>
 *   </CardContent>
 *   <CardFooter>
 *     <Button>操作</Button>
 *   </CardFooter>
 * </Card>
 * ```
 */

import * as React from 'react';
import {cn} from '../../lib/utils';

/**
 * Card 卡片容器组件
 *
 * 作为卡片的最外层容器，提供圆角边框、背景色、阴影等基础视觉样式。
 * 通过 CSS 变量（`border-border`、`bg-card`、`text-card-foreground`）实现主题适配，
 * 支持暗色/亮色主题自动切换。
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({className, ...props}, ref) => (
        <div
            ref={ref}
            className={cn(
                'rounded-xl glass-card text-card-foreground transition-shadow duration-200',
                className
            )}
            {...props}
        />
    )
);
Card.displayName = 'Card';

/**
 * CardHeader 卡片头部组件
 *
 * 位于卡片顶部的区域，提供垂直排列布局和顶部内边距。
 * 通常包含 CardTitle 和 CardDescription，用于展示卡片的标题与摘要信息。
 * 内部子元素之间通过 `space-y-1.5` 保持一致的垂直间距。
 */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({className, ...props}, ref) => (
        <div ref={ref} className={cn('flex flex-col space-y-1.5 p-5', className)} {...props} />
    )
);
CardHeader.displayName = 'CardHeader';

/**
 * CardTitle 卡片标题组件
 *
 * 用于渲染卡片的主标题，渲染为 `<h3>` 语义化标签。
 * 采用半粗字重、紧凑行高和紧缩字间距，视觉上突出且不占用过多空间。
 */
const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({className, ...props}, ref) => (
        <h3
            ref={ref}
            className={cn('font-semibold leading-none tracking-tight', className)}
            {...props}
        />
    )
);
CardTitle.displayName = 'CardTitle';

/**
 * CardDescription 卡片描述组件
 *
 * 用于渲染卡片的辅助说明文字，渲染为 `<p>` 语义化标签。
 * 采用小号字体和柔和的前景色（`text-muted-foreground`），
 * 在视觉层次上次于标题，为用户提供补充信息。
 */
const CardDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({className, ...props}, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

/**
 * CardContent 卡片内容区组件
 *
 * 卡片的主要内容承载区域，提供水平内边距。
 * 注意顶部内边距设为 0（`pt-0`），这是为了与 CardHeader 的底部内边距
 * 自然衔接，避免 header 与 content 之间出现多余间距。
 * 如果没有 CardHeader，可通过 className 单独添加顶部内边距。
 */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({className, ...props}, ref) => (
        <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
    )
);
CardContent.displayName = 'CardContent';

/**
 * CardFooter 卡片底部组件
 *
 * 卡片的底部操作区域，提供水平弹性布局（`flex items-center`），
 * 适合放置操作按钮或附加信息。与 CardContent 类似，顶部内边距为 0，
 * 确保与上方内容区自然衔接。
 */
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({className, ...props}, ref) => (
        <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
    )
);
CardFooter.displayName = 'CardFooter';

export {Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter};
