/**
 * @file Daytona 沙箱服务
 * @description 封装 Daytona SDK，提供统一的沙箱管理接口。
 *   当 Daytona 未配置时，所有方法返回 null/false，上层服务透明回退到本地执行。
 *   沙箱按 workspacePath 复用，避免重复创建。
 */
import { Sandbox } from '@daytonaio/sdk';
/** Daytona 沙箱配置（从 AppConfig['daytona'] 提取） */
export interface DaytonaConfig {
    apiKey?: string;
    apiUrl?: string;
    /** 是否启用 Daytona 沙箱 */
    enabled?: boolean;
    /** 创建沙箱时使用的镜像模板（sandboxId 为空时生效） */
    template?: string;
    /** 预创建的沙箱 ID（优先级最高，指定后不再自动创建沙箱） */
    sandboxId?: string;
}
/** 沙箱执行结果 */
export interface SandboxExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
/** 沙箱状态信息 */
export interface SandboxInfo {
    id: string;
    name: string;
    state: string;
    workspacePath: string;
}
/**
 * Daytona 沙箱服务
 *
 * 封装 Daytona SDK 客户端，提供沙箱生命周期管理和命令执行能力。
 * 设计原则：Daytona 未配置时所有操作静默降级，不抛异常。
 */
export declare class SandboxService {
    private client;
    private config;
    /** workspacePath → Sandbox 实例缓存 */
    private sandboxes;
    constructor(config: DaytonaConfig | undefined);
    /** 初始化 Daytona 客户端 */
    private initClient;
    /** Daytona 沙箱是否启用 */
    isEnabled(): boolean;
    /** 获取或创建沙箱 */
    getSandbox(workspacePath: string, overrideSandboxId?: string): Promise<Sandbox | null>;
    /** 在沙箱中执行命令 */
    executeCommand(workspacePath: string, command: string, cwd?: string, env?: Record<string, string>, sandboxId?: string): Promise<SandboxExecResult | null>;
    /**
     * 将本地工作区的变更文件同步到沙箱
     *
     * 使用 git 获取变更文件列表（包括未提交的新文件），
     * 通过 Daytona SDK 的 uploadFiles API 上传到沙箱。
     * 无 git 仓库时回退到全量同步最近修改的文件。
     *
     * @param localPath - 本地工作区路径
     * @param sandboxId - 目标沙箱 ID
     * @returns 是否同步成功
     */
    syncChangedFiles(localPath: string, sandboxId?: string): Promise<boolean>;
    /**
     * 获取最近修改的文件列表（非 git 仓库的回退方案）
     * 递归扫描目录，返回最近 24 小时内修改的文件，排除 node_modules 等
     */
    private getRecentFiles;
    /** 获取所有活跃沙箱信息 */
    listActive(): Promise<SandboxInfo[]>;
    /** 销毁指定沙箱 */
    destroySandbox(workspacePath: string): Promise<boolean>;
    /** 销毁所有缓存沙箱（服务关闭时调用） */
    cleanup(): Promise<void>;
    /** 获取当前配置状态（用于调试/状态接口） */
    getStatus(): {
        enabled: boolean;
        apiUrl: string;
        sandboxId?: string;
        template?: string;
        activeCount: number;
    };
}
//# sourceMappingURL=sandbox-service.d.ts.map