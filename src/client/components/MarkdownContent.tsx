/**
 * @file Markdown 内容渲染组件
 * @description 基于 react-markdown 的通用 Markdown 渲染组件，
 *   自定义各 HTML 元素的样式以适配项目设计系统。
 *   支持 GFM（GitHub Flavored Markdown）语法，包括表格、任务列表等。
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface MarkdownContentProps {
    /** Markdown 原始文本 */
    content: string;
    /** 额外的 CSS 类名 */
    className?: string;
    /**
     * 图片基础路径，用于将 [Image: filename] 转为标准 markdown 图片。
     * 例如 '/api/requirements/images/reqId'
     * 不传则将 [Image: xxx] 渲染为 alt 文本。
     */
    imageBasePath?: string;
}

/**
 * Markdown 内容渲染组件
 * @description 将 Markdown 文本渲染为格式化的 HTML，样式与项目设计系统一致。
 *   支持标题、列表、表格、代码块、引用、图片、链接等常见元素。
 *   通过 rehype-raw 支持内嵌 HTML（如 MinerU 返回的 HTML 表格）。
 */
/**
 * 预处理：将 ONES 平台的 [Image: filename.png] 转为标准 markdown 图片语法
 */
function preprocessImages(content: string, imageBasePath?: string): string {
    return content.replace(/\[Image:\s*([^\]]+)\]/g, (_match, imageName: string) => {
        const trimmed = imageName.trim();
        const url = imageBasePath ? `${imageBasePath}/${trimmed}` : '';
        return url ? `![${trimmed}](${url})` : `*${trimmed}*`;
    });
}

export function MarkdownContent({content, className = '', imageBasePath}: MarkdownContentProps) {
    const processed = preprocessImages(content, imageBasePath);
    return (
        <div className={`markdown-body ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                    // 标题样式
                    h1: ({children}) => (
                        <h1 className="text-xl font-bold mt-6 mb-3 pb-2 border-b border-border">
                            {children}
                        </h1>
                    ),
                    h2: ({children}) => (
                        <h2 className="text-lg font-semibold mt-5 mb-2 pb-1.5 border-b border-border/50">
                            {children}
                        </h2>
                    ),
                    h3: ({children}) => (
                        <h3 className="text-base font-semibold mt-4 mb-1.5">{children}</h3>
                    ),
                    h4: ({children}) => (
                        <h4 className="text-sm font-semibold mt-3 mb-1">{children}</h4>
                    ),

                    // 段落
                    p: ({children}) => (
                        <p className="text-sm leading-relaxed mb-3 text-foreground/90">{children}</p>
                    ),

                    // 无序列表
                    ul: ({children}) => (
                        <ul className="text-sm space-y-1 mb-3 ml-4 list-disc marker:text-muted-foreground">
                            {children}
                        </ul>
                    ),

                    // 有序列表
                    ol: ({children}) => (
                        <ol className="text-sm space-y-1 mb-3 ml-4 list-decimal marker:text-muted-foreground">
                            {children}
                        </ol>
                    ),

                    // 列表项
                    li: ({children}) => (
                        <li className="leading-relaxed text-foreground/90 pl-1">{children}</li>
                    ),

                    // 行内代码
                    code: ({className, children, ...props}) => {
                        const isBlock = className?.includes('language-');
                        if (isBlock) {
                            return (
                                <code className={`${className} text-xs`} {...props}>
                                    {children}
                                </code>
                            );
                        }
                        return (
                            <code
                                className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono text-foreground/80"
                                {...props}
                            >
                                {children}
                            </code>
                        );
                    },

                    // 代码块
                    pre: ({children}) => (
                        <pre className="rounded-lg bg-muted/60 border border-border p-4 overflow-x-auto mb-3">
                            {children}
                        </pre>
                    ),

                    // 表格（支持 ONES/ckeditor 内嵌 HTML 表格，含合并单元格 colspan/rowspan）
                    table: ({children}) => (
                        <div className="overflow-x-auto mb-3 my-4">
                            <table className="w-full text-sm border-collapse border border-border">{children}</table>
                        </div>
                    ),
                    thead: ({children}) => (
                        <thead className="bg-muted/50">{children}</thead>
                    ),
                    th: ({children, ...props}) => (
                        <th
                            className="px-3 py-2 text-left font-medium text-foreground/80 border border-border align-top"
                            {...props}
                        >
                            {children}
                        </th>
                    ),
                    td: ({children, ...props}) => (
                        <td
                            className="px-3 py-2 border border-border/60 text-foreground/90 align-top [&_p]:my-0"
                            {...props}
                        >
                            {children}
                        </td>
                    ),

                    // 引用
                    blockquote: ({children}) => (
                        <blockquote className="border-l-3 border-primary/40 pl-4 py-1 mb-3 bg-primary/5 rounded-r-md">
                            {children}
                        </blockquote>
                    ),

                    // 链接
                    a: ({href, children}) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline underline-offset-2"
                        >
                            {children}
                        </a>
                    ),

                    // 图片
                    img: ({src, alt}) => (
                        <img
                            src={src}
                            alt={alt || ''}
                            className="max-w-full rounded-lg border border-border my-2"
                            loading="lazy"
                        />
                    ),

                    // 水平线
                    hr: () => (
                        <hr className="my-4 border-border"/>
                    ),

                    // 强调
                    strong: ({children}) => (
                        <strong className="font-semibold text-foreground">{children}</strong>
                    ),
                    em: ({children}) => (
                        <em className="italic text-foreground/80">{children}</em>
                    ),

                    // 删除线
                    del: ({children}) => (
                        <del className="text-muted-foreground line-through">{children}</del>
                    ),
                }}
            >
                {processed}
            </ReactMarkdown>
        </div>
    );
}
