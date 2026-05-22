import { JsonStore } from '../json-store.js';
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
/**
 * 项目特征存储服务
 *
 * 继承 JsonStore 基类，覆盖 upsert 以自动生成 ID。
 */
export declare class ProjectFactsStore extends JsonStore<ProjectFact> {
    constructor(storeFile?: string);
    /** 根据 workspacePath 生成 ID */
    static idFromPath(workspacePath: string): string;
    /** 按工作空间路径查找 */
    getByPath(workspacePath: string): ProjectFact | undefined;
    /** 创建或更新项目特征（自动生成 ID） */
    upsert(fact: Omit<ProjectFact, 'id'> & {
        id?: string;
    }): ProjectFact;
}
//# sourceMappingURL=project-facts-store.d.ts.map