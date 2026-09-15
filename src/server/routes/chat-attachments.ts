/**
 * @file chat-attachments.ts
 * @description 聊天附件上传：按文件类型分流解析后暂存，返回 attachmentId。
 *   - 文本/代码类：直接 UTF-8 读取
 *   - Excel（xlsx/xlsm）：exceljs 解析为 markdown 表格
 *   - PDF/docx/pptx/图片：MinerU 解析（OCR）
 */

import {Router} from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import type {MinerUService} from '../services/mineru-service.js';
import type {AttachmentStore} from '../services/attachment-store.js';
import {getErrorMessage} from '../utils/error-utils.js';

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 100 * 1024 * 1024}});

/** 文本/代码类扩展名：直接读取内容，不走 MinerU */
const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'mdx', 'rst', 'log',
    'json', 'json5', 'jsonc', 'csv', 'tsv', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'properties', 'env',
    'html', 'htm', 'css', 'scss', 'sass', 'less',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte',
    'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
    'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'm', 'mm',
    'php', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'sql',
    'swift', 'dart', 'lua', 'pl', 'r', 'jl', 'ex', 'exs', 'erl', 'hs', 'clj',
    'gitignore', 'dockerfile', 'makefile', 'cmake', 'proto', 'graphql', 'gql',
]);

/** Excel 类扩展名：exceljs 解析 */
const EXCEL_EXTENSIONS = new Set(['xlsx', 'xlsm']);

/** MinerU 可解析扩展名（PDF/Office/图片） */
const MINERU_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'bmp']);

/** 文本附件最大注入字符数：超出截断，避免撑爆 prompt */
const MAX_TEXT_CHARS = 200_000;
/** 每个 Excel 工作表最大解析行数：超出截断 */
const MAX_SHEET_ROWS = 1000;

/** 支持类型提示（错误信息用） */
const SUPPORTED_HINT = '支持的类型：文本/代码文件（md、txt、json、csv、java、py、js、ts 等）、Excel（xlsx）、PDF、Word（docx）、PPT（pptx）、图片（png/jpg）';

function getFileExtension(fileName: string): string {
    const idx = fileName.lastIndexOf('.');
    return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
}

/** 读取文本内容：去 BOM，超长截断并追加标注 */
function decodeText(buffer: Buffer, fileName: string): string {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.length > MAX_TEXT_CHARS) {
        text = `${text.slice(0, MAX_TEXT_CHARS)}\n\n[内容过长，已截断：原文件共 ${text.length} 字符]`;
    }
    if (!text.trim()) {
        throw Object.assign(new Error(`未能从文件「${fileName}」读取到文本内容`), {statusCode: 422, code: 'PARSE_EMPTY'});
    }
    return text;
}

/** Excel 解析为 markdown 表格（每个工作表一节） */
async function decodeExcel(buffer: Buffer, fileName: string): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer as never);
    } catch {
        throw Object.assign(
            new Error(`无法解析 Excel 文件「${fileName}」，若为旧版 .xls 请先另存为 .xlsx`),
            {statusCode: 422, code: 'PARSE_EMPTY'},
        );
    }
    const sections: string[] = [];
    for (const sheet of workbook.worksheets) {
        if (!sheet.rowCount) continue;
        const lines: string[] = [`### ${sheet.name}`];
        let header: string[] | null = null;
        let rowCount = 0;
        let truncated = false;
        sheet.eachRow({includeEmpty: false}, (row) => {
            if (rowCount >= MAX_SHEET_ROWS) {
                truncated = true;
                return;
            }
            const cells = (row.values as unknown[])
                .slice(1)
                .map(v => (v === null || v === undefined ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')));
            if (!header) {
                header = cells;
                lines.push(`| ${cells.join(' | ')} |`);
                lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
            } else {
                lines.push(`| ${cells.join(' | ')} |`);
            }
            rowCount++;
        });
        if (truncated) lines.push(`\n[仅展示前 ${MAX_SHEET_ROWS} 行]`);
        sections.push(lines.join('\n'));
    }
    const markdown = sections.join('\n\n').trim();
    if (!markdown) {
        throw Object.assign(new Error(`Excel 文件「${fileName}」中没有可读取的数据`), {statusCode: 422, code: 'PARSE_EMPTY'});
    }
    return markdown;
}

export function createChatAttachmentRoutes(mineruService: MinerUService, attachmentStore: AttachmentStore): Router {
    const router = Router();

    // POST /api/chat-attachments/upload — multipart 字段名 file，单文件
    router.post('/upload', upload.single('file'), async (req, res) => {
        try {
            const file = req.file as Express.Multer.File | undefined;
            if (!file) {
                res.status(400).json({code: 'NO_FILE', message: 'No file uploaded'});
                return;
            }
            const ext = getFileExtension(file.originalname);

            let markdown: string;
            if (TEXT_EXTENSIONS.has(ext)) {
                markdown = decodeText(file.buffer, file.originalname);
            } else if (EXCEL_EXTENSIONS.has(ext)) {
                markdown = await decodeExcel(file.buffer, file.originalname);
            } else if (MINERU_EXTENSIONS.has(ext)) {
                const result = await mineruService.parseBuffer(
                    file.originalname,
                    file.buffer,
                    file.mimetype,
                );
                markdown = result.markdown?.trim() ?? '';
                if (!result.success || !markdown) {
                    res.status(422).json({
                        code: 'PARSE_EMPTY',
                        message: `未能从文件「${file.originalname}」解析出文本内容`,
                    });
                    return;
                }
            } else {
                res.status(422).json({
                    code: 'UNSUPPORTED_TYPE',
                    message: `暂不支持「.${ext || '无扩展名'}」类型。${SUPPORTED_HINT}`,
                });
                return;
            }

            const att = attachmentStore.save(file.originalname, markdown);
            res.json({attachmentId: att.id, fileName: att.fileName, chars: att.chars});
        } catch (err) {
            const status = (err as {statusCode?: number}).statusCode ?? 500;
            res.status(status).json({
                code: (err as {code?: string}).code ?? 'ATTACHMENT_PARSE_ERROR',
                message: getErrorMessage(err),
            });
        }
    });

    return router;
}
