/**
 * @file 测试 Provider 类型定义
 * @description 定义测试框架 Provider 的统一接口和公共数据模型。
 *   每种项目类型（Node/Java/Python 等）实现一个 Provider，
 *   负责项目检测、测试目标发现、命令生成和输出解析。
 */
/**
 * 测试结果接口
 * @description 表示一次测试执行的完整结果汇总
 */
export interface TestResults {
    /** 测试框架名称 */
    framework: string;
    /** 测试用例总数 */
    totalTests: number;
    /** 通过的用例数 */
    passed: number;
    /** 失败的用例数 */
    failed: number;
    /** 跳过的用例数 */
    skipped: number;
    /** 执行耗时（毫秒） */
    duration: number;
    /** 代码覆盖率百分比（可选） */
    coverage?: number;
    /** 测试套件列表 */
    suites: TestSuite[];
}
/**
 * 测试套件接口
 * @description 表示一组相关的测试用例集合
 */
export interface TestSuite {
    /** 套件名称 */
    name: string;
    /** 套件中的测试用例列表 */
    tests: TestCase[];
}
/**
 * 测试用例接口
 * @description 表示单个测试用例的执行结果
 */
export interface TestCase {
    /** 用例名称 */
    name: string;
    /** 用例执行状态 */
    status: 'passed' | 'failed' | 'skipped';
    /** 用例执行耗时（毫秒） */
    duration: number;
    /** 失败时的错误信息（仅 status 为 'failed' 时有值） */
    error?: string;
    /** 失败时的截图路径（仅 status 为 'failed' 时有值） */
    screenshot?: string;
}
/**
 * 项目信息
 * @description 由 Provider 检测返回，描述项目的语言、构建工具和测试框架
 */
export interface ProjectInfo {
    /** 项目类型标识（如 node, java, python） */
    type: string;
    /** 显示名称（如 "Node.js", "Java (Maven)"） */
    label: string;
    /** 构建工具（如 maven, gradle, npm, pnpm, pip） */
    buildTool: string;
    /** 检测到的测试框架列表（一个项目可能有多个） */
    testFrameworks: TestFrameworkDetail[];
    /** 项目根路径 */
    rootPath: string;
}
/**
 * 测试框架详情
 * @description 表示单个测试框架的检测结果和配置信息
 */
export interface TestFrameworkDetail {
    /** 框架名称（如 vitest, jest, playwright, pytest） */
    name: string;
    /** 是否确信检测到 */
    detected: boolean;
    /** 配置文件路径 */
    configFile?: string;
    /** 执行命令 */
    command: string;
    /** 是否支持 JSON 结构化输出 */
    supportsJsonOutput: boolean;
    /** JSON 输出的命令行参数 */
    jsonOutputArgs?: string[];
}
/**
 * 测试目标
 * @description 表示一个可运行的测试文件/类
 */
export interface TestTarget {
    /** 测试文件路径（相对于 workspace） */
    filePath: string;
    /** 对应的源文件路径（可选，用于变更点映射） */
    sourceFile?: string;
    /** 所属测试框架 */
    framework: string;
}
/**
 * 测试 Provider 接口
 * @description 每种项目类型实现此接口，提供检测、目标发现、命令生成和输出解析能力
 */
export interface TestProvider {
    /** Provider 类型标识（如 'node', 'java', 'python', 'generic'） */
    type: string;
    /** 检测优先级（数字越小越优先） */
    priority: number;
    /**
     * 检测项目是否匹配此 Provider
     * @param workspacePath - 项目工作空间路径
     * @returns 项目信息，不匹配时返回 null
     */
    detect(workspacePath: string): ProjectInfo | null;
    /**
     * 根据变更文件列出可运行的测试目标
     * @param workspacePath - 项目工作空间路径
     * @param changedFiles - 变更文件列表（可选，为空则列出所有测试目标）
     * @returns 测试目标列表
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[];
    /**
     * 获取框架的默认执行命令
     * @param framework - 框架名称
     * @param targets - 指定的测试目标（可选，用于定向执行）
     * @param filter - 测试名称过滤条件（可选）
     * @returns 完整的测试执行命令字符串
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string;
    /**
     * 解析测试输出为结构化结果
     * @param framework - 框架名称
     * @param stdout - 标准输出
     * @param stderr - 标准错误
     * @param exitCode - 进程退出码
     * @returns 结构化测试结果
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults;
}
/**
 * 测试框架检测信息（兼容旧接口）
 * @deprecated 新代码应使用 TestFrameworkDetail
 */
export interface TestFrameworkInfo {
    name: string;
    detected: boolean;
    configFile?: string;
    command: string;
}
//# sourceMappingURL=types.d.ts.map