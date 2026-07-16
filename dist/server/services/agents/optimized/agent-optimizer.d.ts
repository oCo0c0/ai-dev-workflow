/**
 * Agent优化助手
 */
export interface OptimizedAgentConfig {
    maxIterations: number;
    qualityThreshold: number;
}
/**
 * 为Agent的decide方法添加统一的迭代限制
 */
export declare function addIterationLimit(originalDecide: (context: any) => Promise<any>, maxIterations?: number): (context: any) => Promise<any>;
/**
 * 为Agent的think方法添加提前终止逻辑
 */
export declare function addEarlyTermination(originalThink: (context: any) => Promise<any>, qualityThreshold?: number): (context: any) => Promise<any>;
/**
 * 优化Agent的observe方法，改进质量评估
 */
export declare function improveObservation(originalObserve: (context: any, result: any) => Promise<any>): (context: any, result: any) => Promise<any>;
/**
 * 应用所有优化到Agent
 */
export declare function applyAgentOptimizations(agent: any): any;
//# sourceMappingURL=agent-optimizer.d.ts.map