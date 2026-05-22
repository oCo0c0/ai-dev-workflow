import { UserProfileStore, type UserProfile } from './user-profile-store.js';
import { ProjectFactsStore, type ProjectFact } from './project-facts-store.js';
import { FeedbackLogStore, type FeedbackEntry } from './feedback-log-store.js';
/**
 * 记忆系统门面服务
 */
export declare class MemoryService {
    private userProfileStore;
    private projectFactsStore;
    private feedbackLogStore;
    constructor(userProfileStore?: UserProfileStore, projectFactsStore?: ProjectFactsStore, feedbackLogStore?: FeedbackLogStore);
    /**
     * 注册事件订阅
     */
    private registerListeners;
    /**
     * 处理执行完成事件 — 更新框架偏好
     */
    private handleExecutionComplete;
    /**
     * 处理测试完成事件 — 更新测试框架偏好
     */
    private handleTestComplete;
    /**
     * 自动收集项目特征
     *
     * 读取 package.json、tsconfig.json 等配置文件，推断技术栈、测试框架、目录约定。
     * 首次遇到新 workspace 时调用。
     */
    collectProjectFacts(workspacePath: string): ProjectFact | null;
    /**
     * 构建给定 workspace 的 prompt 增强上下文
     *
     * 组合用户画像和项目特征，生成结构化的上下文文本。
     * 返回空字符串表示无可用记忆。
     */
    buildContextEnrichment(workspacePath: string): string;
    getUserProfile(): UserProfile;
    updateUserProfile(partial: Partial<Omit<UserProfile, 'id'>>): UserProfile;
    getProjectFacts(workspacePath: string): ProjectFact | undefined;
    getFeedbackLog(limit?: number): FeedbackEntry[];
    addFeedback(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry;
    /** 获取 store 实例（供路由直接使用） */
    get userProfile(): UserProfileStore;
    get projectFacts(): ProjectFactsStore;
    get feedbackLog(): FeedbackLogStore;
}
//# sourceMappingURL=memory-service.d.ts.map