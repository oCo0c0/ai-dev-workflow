/**
 * @module memory-notes-store
 * @description 用户手动记忆笔记存储
 *
 * 与自动收集的「项目事实 / 用户画像 / 反馈日志」并列的第四类记忆：
 * 用户通过 `/memory add <内容>` 显式写入的长期记忆（约定、偏好、注意事项等），
 * 存放于 `~/.ai-dev-workbench/memory/notes.json`，可按工作区归属与关键词检索。
 */
import path from 'path';
import {randomUUID} from 'crypto';
import {MEMORY_DIR} from '../../utils/constants.js';
import {JsonStore} from '../json-store.js';

/** 记忆笔记条目 */
export interface MemoryNote {
    id: string;
    /** 笔记正文 */
    content: string;
    /** 归属工作区（空串表示全局） */
    workspacePath: string;
    /** 关键词标签 */
    tags: string[];
    /** 来源：manual = 用户手写；compact = 上下文压缩摘要 */
    source: 'manual' | 'compact';
    createdAt: string;
    updatedAt: string;
}

const STORE_FILE = path.join(MEMORY_DIR, 'notes.json');

/**
 * 记忆笔记存储
 */
export class MemoryNotesStore extends JsonStore<MemoryNote> {
    constructor(storeFile?: string) {
        super({defaultPath: STORE_FILE, maxRecords: 500, sortField: 'createdAt'}, storeFile);
    }

    /**
     * 新增笔记
     * @param content - 笔记正文
     * @param workspacePath - 归属工作区（可选）
     * @param source - 来源（默认 manual）
     * @param tags - 标签（可选）
     */
    add(content: string, workspacePath = '', source: MemoryNote['source'] = 'manual', tags: string[] = []): MemoryNote {
        const now = new Date().toISOString();
        const note: MemoryNote = {
            id: randomUUID(),
            content: content.trim(),
            workspacePath,
            tags,
            source,
            createdAt: now,
            updatedAt: now,
        };
        this.upsert(note);
        return note;
    }

    /** 按工作区过滤（含全局笔记） */
    listFor(workspacePath?: string): MemoryNote[] {
        const all = this.list();
        if (!workspacePath) return all;
        return all.filter(n => !n.workspacePath || n.workspacePath === workspacePath);
    }

    /** 关键词检索（正文 / 标签，大小写不敏感） */
    search(keyword: string, workspacePath?: string): MemoryNote[] {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return [];
        return this.listFor(workspacePath).filter(n =>
            n.content.toLowerCase().includes(kw)
            || n.tags.some(t => t.toLowerCase().includes(kw)));
    }
}
