/**
 * store.downloadImages 的附件清洗回归：
 * 同名同址去重 + 图片型死条目（无 URL 且本地无文件）移除。
 * （构造函数收 dataDir；图片直连用不可达回环地址避免真实网络依赖。）
 */

import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {RequirementStore} from './store.js';
import type {RequirementDetail} from './requirement-sources/index.js';

function makeTmpStore(): {store: RequirementStore; dir: string} {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-store-test-'));
    return {store: new RequirementStore(dir), dir};
}

function detail(id: string): RequirementDetail {
    return {
        id,
        number: 'R-1',
        title: 't',
        status: 'open',
        priority: 'P2',
        assignee: '',
        updatedAt: new Date().toISOString(),
        description: '',
        acceptanceCriteria: [],
        relatedIssues: [],
        attachments: [],
    };
}

describe('RequirementStore.downloadImages 附件清洗', () => {
    it('dedupes same-name same-url entries and drops dead image entries', async () => {
        const {store} = makeTmpStore();
        const req = detail('r1');
        req.attachments = [
            {name: 'image.png', url: '', type: 'image/png'},                          // 死条目（无 URL 无文件）
            {name: 'image.png', url: '', type: 'image/png'},                          // 同名同址重复
            {name: 'remote.png', url: 'http://127.0.0.1:9/x.png', type: 'image/png'}, // 直连不可达 → 保留（URL 仍有效）
            {name: 'spec.pdf', url: '', type: 'application/pdf'},                     // 非图片，保留
        ];

        await store.downloadImages(req, undefined, '/api/dsh-adw/requirements/r1/images');

        expect(req.attachments.filter(a => a.name === 'image.png')).toHaveLength(0);
        expect(req.attachments.map(a => a.name)).toContain('remote.png');
        expect(req.attachments.map(a => a.name)).toContain('spec.pdf');
    });

    it('keeps url-less image entry when the file already localized on disk', async () => {
        const {store, dir} = makeTmpStore();
        const req = detail('r2');
        // 模拟富文本提取路径已落盘：无 URL 但文件在 → 保留 + 改写为本地地址
        const imgDir = path.join(dir, 'images', 'r2');
        fs.mkdirSync(imgDir, {recursive: true});
        fs.writeFileSync(path.join(imgDir, 'shot.png'), Buffer.from('PNG'));
        req.attachments = [{name: 'shot.png', url: '', type: 'image/png'}, {name: 'shot.png', url: '', type: 'image/png'}];

        await store.downloadImages(req, undefined, '/api/dsh-adw/requirements/r2/images');

        expect(req.attachments).toHaveLength(1);
        expect(req.attachments[0].url).toBe('/api/dsh-adw/requirements/r2/images/shot.png');
    });
});
