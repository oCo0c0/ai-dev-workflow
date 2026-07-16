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
export function addIterationLimit(
    originalDecide: (context: any) => Promise<any>,
    maxIterations: number = 5
) {
    return async function (context: any): Promise<any> {
        const iteration = context.state.iteration;

        // 达到最大迭代次数，强制完成
        if (iteration >= maxIterations) {
            return {
                type: 'complete',
                parameters: {}
            };
        }

        // 调用原始decide方法
        const action = await originalDecide(context);

        // 如果原始decide也返回complete，保持不变
        if (action.type === 'complete') {
            return action;
        }

        return action;
    };
}

/**
 * 为Agent的think方法添加提前终止逻辑
 */
export function addEarlyTermination(
    originalThink: (context: any) => Promise<any>,
    qualityThreshold: number = 0.9
) {
    return async function (context: any): Promise<any> {
        const thought = await originalThink(context);

        // 如果当前质量已经很高，提前完成
        if (context.state.quality >= qualityThreshold && context.state.iteration > 0) {
            return {
                ...thought,
                nextAction: {
                    type: 'complete',
                    parameters: {}
                }
            };
        }

        return thought;
    };
}

/**
 * 优化Agent的observe方法，改进质量评估
 */
export function improveObservation(
    originalObserve: (context: any, result: any) => Promise<any>
) {
    return async function (context: any, result: any): Promise<any> {
        const observation = await originalObserve(context, result);

        // 改进质量评估逻辑
        if (observation.quality < 0.3) {
            // 如果质量太低，需要改进
            observation.needsImprovement = true;
        } else if (observation.quality >= 0.9) {
            // 质量很好，不需要改进
            observation.needsImprovement = false;
        }

        return observation;
    };
}

/**
 * 应用所有优化到Agent
 */
export function applyAgentOptimizations(agent: any): any {
    const config: OptimizedAgentConfig = {
        maxIterations: 4,
        qualityThreshold: 0.85
    };

    // 包装decide方法
    if (agent.decide && typeof agent.decide === 'function') {
        const originalDecide = agent.decide.bind(agent);
        agent.decide = addIterationLimit(originalDecide, config.maxIterations);
    }

    // 可选：包装think方法
    // agent.think = addEarlyTermination(agent.think.bind(agent), config.qualityThreshold);

    return agent;
}
