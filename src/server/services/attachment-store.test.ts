import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AttachmentStore, formatAttachmentsBlock} from './attachment-store.js';

describe('AttachmentStore', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('save 生成 id 并记录字符数', () => {
        const store = new AttachmentStore();
        const att = store.save('a.pdf', '# hello');
        expect(att.id).toBeTruthy();
        expect(att.fileName).toBe('a.pdf');
        expect(att.chars).toBe('# hello'.length);
        expect(store.get(att.id)?.markdown).toBe('# hello');
    });

    it('save 净化文件名中的引号，避免破坏 XML 附件块结构', () => {
        const store = new AttachmentStore();
        const att = store.save('需求"草稿".pdf', '# 内容');
        expect(att.fileName).toBe("需求'草稿'.pdf");
    });

    it('drain 一次性消费：取出后删除，未知 id 忽略', () => {
        const store = new AttachmentStore();
        const a = store.save('a.pdf', 'A');
        const b = store.save('b.pdf', 'B');
        const drained = store.drain([a.id, 'nope', b.id]);
        expect(drained.map(d => d.id)).toEqual([a.id, b.id]);
        expect(store.get(a.id)).toBeUndefined();
        expect(store.drain([a.id])).toEqual([]);
    });

    it('bindPending/takePending 按会话主体一次性取走', () => {
        const store = new AttachmentStore();
        const a = store.save('a.pdf', 'A');
        store.bindPending('exec-1', [a]);
        expect(store.takePending('exec-1').map(x => x.id)).toEqual([a.id]);
        expect(store.takePending('exec-1')).toEqual([]);
    });

    it('sweep 清理超过 TTL 的条目', () => {
        const store = new AttachmentStore();
        const a = store.save('a.pdf', 'A');
        vi.advanceTimersByTime(31 * 60 * 1000);
        store.sweep();
        expect(store.get(a.id)).toBeUndefined();
    });
});

describe('formatAttachmentsBlock', () => {
    it('空数组返回空串', () => {
        expect(formatAttachmentsBlock([])).toBe('');
    });
    it('生成 XML 风格附件块', () => {
        const md = formatAttachmentsBlock([
            {id: '1', fileName: '需求.pdf', markdown: '# 内容', chars: 4, createdAt: 0},
        ]);
        expect(md).toContain('<attachments>');
        expect(md).toContain('<attachment name="需求.pdf">');
        expect(md).toContain('# 内容');
        expect(md).toContain('</attachments>');
    });
});
