/**
 * @file CLIRunnerService 单元测试
 * @description 测试 CLI 运行器服务的可用性检查功能。
 *              该服务负责检测系统中 Claude Code CLI 工具是否已安装并可用，
 *              包括版本信息的获取。测试通过创建临时目录来模拟隔离环境，
 *              确保测试之间不会相互干扰。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {CLIRunnerService} from './cli-runner-service.js';

describe('CLIRunnerService', () => {
    /** @description 测试用临时目录路径，用于隔离文件系统操作 */
    let tempDir: string;
    /** @description 被测试的 CLI 运行器服务实例 */
    let service: CLIRunnerService;

    /**
     * 测试前置钩子：在每个测试用例执行前
     * - 创建一个唯一的临时目录，用于隔离测试环境
     * - 实例化 CLIRunnerService 以供测试使用
     */
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-runner-test-'));
        service = new CLIRunnerService();
    });

    /**
     * 测试后置钩子：在每个测试用例执行后
     * - 递归删除临时目录及其所有内容，确保测试环境干净
     * - force: true 确保即使目录非空也能删除
     */
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('checkAvailability', () => {
        /**
         * 测试：检查 CLI 可用性应返回包含 available 属性的对象
         * @description 验证 checkAvailability 方法返回一个具有 available 属性的对象。
         *              如果 CLI 可用（available 为 true），则应包含 version 字段；
         *              如果 CLI 不可用（available 为 false），则应包含 error 字段。
         *              该测试在不同环境下都能正常工作，因为它是条件性断言。
         */
        it('returns an object with available property', async () => {
            const result = await service.checkAvailability();
            // 验证返回对象必须包含 available 属性
            expect(result).toHaveProperty('available');
            if (result.available) {
                // CLI 可用时，应返回版本信息
                expect(result.version).toBeDefined();
            } else {
                // CLI 不可用时，应返回错误信息
                expect(result.error).toBeDefined();
            }
        });
    });
});
