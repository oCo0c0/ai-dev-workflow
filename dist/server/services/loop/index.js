"use strict";
/**
 * Loop System - 统一导出
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoStrategyExample = exports.costOptimizationExample = exports.qualityLoopExample = exports.adaptiveLoopExample = exports.runAllLoopExamples = exports.CostOptimizer = exports.createCostOptimizer = exports.QualityLoop = exports.createQualityLoop = exports.AdaptiveLoop = exports.createAdaptiveLoop = exports.executeCostOptimization = exports.executeQualityLoop = exports.executeAdaptiveLoop = exports.LoopService = exports.createLoopService = void 0;
// 核心服务
var loop_service_js_1 = require("./loop-service.js");
Object.defineProperty(exports, "createLoopService", { enumerable: true, get: function () { return loop_service_js_1.createLoopService; } });
Object.defineProperty(exports, "LoopService", { enumerable: true, get: function () { return loop_service_js_1.LoopService; } });
Object.defineProperty(exports, "executeAdaptiveLoop", { enumerable: true, get: function () { return loop_service_js_1.executeAdaptiveLoop; } });
Object.defineProperty(exports, "executeQualityLoop", { enumerable: true, get: function () { return loop_service_js_1.executeQualityLoop; } });
Object.defineProperty(exports, "executeCostOptimization", { enumerable: true, get: function () { return loop_service_js_1.executeCostOptimization; } });
// 组件
var adaptive_loop_js_1 = require("./adaptive-loop.js");
Object.defineProperty(exports, "createAdaptiveLoop", { enumerable: true, get: function () { return adaptive_loop_js_1.createAdaptiveLoop; } });
Object.defineProperty(exports, "AdaptiveLoop", { enumerable: true, get: function () { return adaptive_loop_js_1.AdaptiveLoop; } });
var quality_loop_js_1 = require("./quality-loop.js");
Object.defineProperty(exports, "createQualityLoop", { enumerable: true, get: function () { return quality_loop_js_1.createQualityLoop; } });
Object.defineProperty(exports, "QualityLoop", { enumerable: true, get: function () { return quality_loop_js_1.QualityLoop; } });
var cost_optimizer_js_1 = require("./cost-optimizer.js");
Object.defineProperty(exports, "createCostOptimizer", { enumerable: true, get: function () { return cost_optimizer_js_1.createCostOptimizer; } });
Object.defineProperty(exports, "CostOptimizer", { enumerable: true, get: function () { return cost_optimizer_js_1.CostOptimizer; } });
// 类型定义
__exportStar(require("./types.js"), exports);
// 示例
var text_optimization_loop_js_1 = require("./examples/text-optimization-loop.js");
Object.defineProperty(exports, "runAllLoopExamples", { enumerable: true, get: function () { return text_optimization_loop_js_1.runAllLoopExamples; } });
Object.defineProperty(exports, "adaptiveLoopExample", { enumerable: true, get: function () { return text_optimization_loop_js_1.adaptiveLoopExample; } });
Object.defineProperty(exports, "qualityLoopExample", { enumerable: true, get: function () { return text_optimization_loop_js_1.qualityLoopExample; } });
Object.defineProperty(exports, "costOptimizationExample", { enumerable: true, get: function () { return text_optimization_loop_js_1.costOptimizationExample; } });
Object.defineProperty(exports, "autoStrategyExample", { enumerable: true, get: function () { return text_optimization_loop_js_1.autoStrategyExample; } });
//# sourceMappingURL=index.js.map