/**
 * @file chat-attachments.ts
 * @description 聊天附件上传：文件经 MinerU 解析为 markdown 暂存，返回 attachmentId。
 */

import {Router} from 'express';
import multer from 'multer';
import type {MinerUService} from '../services/mineru-service.js';
import type {AttachmentStore} from '../services/attachment-store.js';
import {getErrorMessage} from '../utils/error-utils.js';

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 100 * 1024 * 1024}});

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
            const result = await mineruService.parseBuffer(
                file.originalname,
                file.buffer,
                file.mimetype,
            );
            const markdown = result.markdown?.trim();
            if (!result.success || !markdown) {
                res.status(422).json({
                    code: 'PARSE_EMPTY',
                    message: `未能从文件「${file.originalname}」解析出文本内容`,
                });
                return;
            }
            const att = attachmentStore.save(file.originalname, markdown);
            res.json({attachmentId: att.id, fileName: att.fileName, chars: att.chars});
        } catch (err) {
            res.status(500).json({code: 'ATTACHMENT_PARSE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
