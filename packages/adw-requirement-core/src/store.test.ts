/**
 * store.downloadImages 回归：
 * 1) 下载范围 = 真实 http URL 的图片/Excel 附件 + 文档 [Image:] 引用（wiki hash 无 URL 资源）
 * 2) 附件清洗 = 只保留「有真实远程 URL」或「已本地化且被文档引用」的条目（解析输入清单）
 * 3) [Image:] 改写：本地有文件 → 本地 markdown；无文件无有效 URL → 明示未下载
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

function detail(id: string, description = ''): RequirementDetail {
    return {
        id,
        number: 'R-1',
        title: 't',
        status: 'open',
        priority: 'P2',
        assignee: '',
        updatedAt: new Date().toISOString(),
        description,
        acceptanceCriteria: [],
        relatedIssues: [],
        attachments: [],
    };
}

/** 假图片服务：记录收到的资源名；可选把部分文件写盘 */
function fakeImageService(collected: string[], writeNames: string[] = []) {
    return {
        async downloadWikiImages(_task: string, resources: Array<{name: string}>, imgDir: string): Promise<number> {
            collected.push(...resources.map(r => r.name));
            for (const name of writeNames) fs.writeFileSync(path.join(imgDir, name), Buffer.from('DATA'));
            return writeNames.length;
        },
        async downloadTaskImages(): Promise<Array<unknown>> { return []; },
        async downloadImage(): Promise<boolean> { return false; },
    };
}

describe('RequirementStore.downloadImages 下载范围', () => {
    it('collects http-url images/excel and doc-referenced markers; skips unreferenced url-less wiki hashes', async () => {
        const {store} = makeTmpStore();
        const req = detail('r1', '正文\n[Image: wiki-ref.png]\n[Image: wiki-miss.png]\n结束');
        req.attachments = [
            {name: 'att.png', url: 'http://127.0.0.1:9/att.png', type: 'image/png'},   // 真实附件（有 URL）
            {name: 'plan.xlsx', url: 'http://127.0.0.1:9/plan.xlsx', type: 'application/vnd.ms-excel'},
            {name: 'wiki-ref.png', url: '', type: 'image/png'},                          // 无 URL 但被文档引用
            {name: 'wiki-miss.png', url: '', type: 'image/png'},                         // 无 URL 被引用但下载失败
            {name: 'wiki-old.png', url: '', type: 'image/png'},                          // 无 URL 未被引用（历史图）→ 不下载不列出
            {name: 'spec.pdf', url: 'http://127.0.0.1:9/spec.pdf', type: 'application/pdf'}, // 有 URL 非下载范围 → 保留
            {name: 'dead.pdf', url: '', type: 'application/pdf'},                        // 无 URL 无文件 → 死条目
        ];
        const collected: string[] = [];
        // 只把 wiki-ref.png 写盘（模拟 token 下载成功；wiki-miss 失败）
        const service = fakeImageService(collected, ['wiki-ref.png']);

        await store.downloadImages(req, service, '/api/dsh-adw/requirements/r1/images');

        // 下载集：真实附件 + 两个被引用标记；未引用的 wiki-old 不进
        expect(collected.sort()).toEqual(['att.png', 'plan.xlsx', 'wiki-miss.png', 'wiki-ref.png']);

        // 清单：att/plan/spec（远程 URL）+ wiki-ref（本地化+被引用）；wiki-old / wiki-miss / dead.pdf 移除
        const names = req.attachments.map(a => a.name).sort();
        expect(names).toEqual(['att.png', 'plan.xlsx', 'spec.pdf', 'wiki-ref.png']);
        expect(req.attachments.find(a => a.name === 'wiki-ref.png')?.url)
            .toBe('/api/dsh-adw/requirements/r1/images/wiki-ref.png');

        // 描述：引用且已下载 → 本地图片；引用但下载失败 → 明示未下载
        expect(req.description).toContain('![wiki-ref.png](/api/dsh-adw/requirements/r1/images/wiki-ref.png)');
        expect(req.description).toContain('[图片未下载：wiki-miss.png]');
    });

    it('collects excel without url only when doc-referenced via [Image:] marker', async () => {
        const {store} = makeTmpStore();
        const req = detail('r2', '[Image: 取值逻辑.xlsx]');
        req.attachments = [
            {name: '取值逻辑.xlsx', url: '', type: 'application/vnd.ms-excel'},
            {name: '历史表.xlsx', url: '', type: 'application/vnd.ms-excel'},
        ];
        const collected: string[] = [];
        const service = fakeImageService(collected, ['取值逻辑.xlsx']);

        await store.downloadImages(req, service, '/api/dsh-adw/requirements/r2/images');

        expect(collected).toEqual(['取值逻辑.xlsx']);
        expect(req.attachments.map(a => a.name)).toEqual(['取值逻辑.xlsx']);
        expect(req.attachments[0].url).toBe(`/api/dsh-adw/requirements/r2/images/${encodeURIComponent('取值逻辑.xlsx')}`);
    });
});

describe('RequirementStore.downloadImages 附件清洗', () => {
    it('dedupes same-name entries; keeps remote-url and localized-referenced entries', async () => {
        const {store, dir} = makeTmpStore();
        const req = detail('r3', '看 [Image: shot.png]');
        req.attachments = [
            {name: 'shot.png', url: '', type: 'image/png'},                           // 重复
            {name: 'shot.png', url: '', type: 'image/png'},                           // → 去重后留一条（本地化+被引用）
            {name: 'remote.png', url: 'http://127.0.0.1:9/x.png', type: 'image/png'}, // 远程 URL → 保留
            {name: 'live-doc.pdf', url: 'http://127.0.0.1:9/d.pdf', type: 'application/pdf'}, // 有 URL → 保留
        ];

        // 先落盘 shot.png（模拟已本地化）
        const shotDir = path.join(dir, 'images', 'r3');
        fs.mkdirSync(shotDir, {recursive: true});
        fs.writeFileSync(path.join(shotDir, 'shot.png'), Buffer.from('PNG'));

        await store.downloadImages(req, undefined, '/api/dsh-adw/requirements/r3/images');

        expect(req.attachments.filter(a => a.name === 'shot.png')).toHaveLength(1);
        expect(req.attachments.find(a => a.name === 'shot.png')?.url).toBe('/api/dsh-adw/requirements/r3/images/shot.png');
        expect(req.attachments.map(a => a.name)).toContain('remote.png');
        expect(req.attachments.map(a => a.name)).toContain('live-doc.pdf');
        expect(req.description).toContain('![shot.png](/api/dsh-adw/requirements/r3/images/shot.png)');
    });

    it('drops url-less entries when no local file even if referenced (download failed)', async () => {
        const {store} = makeTmpStore();
        const req = detail('r4', '[Image: gone.png]');
        req.attachments = [{name: 'gone.png', url: '', type: 'image/png'}];

        await store.downloadImages(req, undefined, '/api/dsh-adw/requirements/r4/images');

        expect(req.attachments).toHaveLength(0);
        expect(req.description).toContain('[图片未下载：gone.png]');
    });
});
