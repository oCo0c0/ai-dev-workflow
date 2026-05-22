/**
 * @module project-facts-store
 * @description 项目特征持久化存储
 *
 * 按工作空间路径索引，存储项目技术栈、测试框架、目录约定等特征信息。
 * 存储在 ~/.ai-dev-workbench/memory/project-facts.json，上限 20 条。
 */
import path from 'path';
import crypto from 'crypto';
import {JsonStore} from '../json-store.js';
import {MEMORY_DIR} from '../../utils/constants.js';

/** 目录约定接口 */
export interface DirectoryConventions {
    sourceDir: string;
    testDir: string;
    configFiles: string[];
}

/** 项目特征接口 */
export interface ProjectFact {
    /** workspacePath 的 hash */
    id: string;
    workspacePath: string;
    techStack: string[];
    testFrameworks: string[];
    directoryConventions: DirectoryConventions;
    buildTool: string;
    inferredAt: string;
    updatedAt: string;
}

const STORE_FILE = path.join(MEMORY_DIR, 'project-facts.json');

/**
 * 项目特征存储服务
 *
 * 继承 JsonStore 基类，覆盖 upsert 以自动生成 ID。
 */
export class ProjectFactsStore extends JsonStore<ProjectFact> {
    constructor(storeFile?: string) {
        super({defaultPath: STORE_FILE, maxRecords: 20, sortField: 'updatedAt'}, storeFile);
    }

    /** 根据 workspacePath 生成 ID */
    static idFromPath(workspacePath: string): string {
        return crypto.createHash('md5').update(workspacePath).digest('hex').substring(0, 12);
    }

    /** 按工作空间路径查找 */
    getByPath(workspacePath: string): ProjectFact | undefined {
        const id = ProjectFactsStore.idFromPath(workspacePath);
        return this.get(id);
    }

    /** 创建或更新项目特征（自动生成 ID） */
    upsert(fact: Omit<ProjectFact, 'id'> & { id?: string }): ProjectFact {
        const id = fact.id ?? ProjectFactsStore.idFromPath(fact.workspacePath);
        return super.upsert({...fact, id} as ProjectFact);
    }
}
