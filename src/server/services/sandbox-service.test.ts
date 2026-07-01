/**
 * @file SandboxService 单元测试
 * @description 测试 Daytona 沙箱服务的核心逻辑。SDK 通过手动 mock 模拟。
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock Daytona SDK
const mockCreate = vi.fn();
const mockList = vi.fn();
const mockDelete = vi.fn();
const mockExecuteCommand = vi.fn();
const mockRefreshData = vi.fn();

vi.mock('@daytona/sdk', () => ({
    Daytona: vi.fn().mockImplementation(() => ({
        create: mockCreate,
        list: mockList,
    })),
    SandboxState: {
        CREATING: 'creating',
        STARTED: 'started',
        STOPPED: 'stopped',
        DESTROYED: 'destroyed',
        ERROR: 'error',
    },
}));

const {SandboxService} = await import('./sandbox-service.js');

/** 创建符合 Sandbox 接口的 mock 对象 */
function makeMockSandbox(overrides: Record<string, unknown> = {}) {
    return {
        state: 'started' as string,
        id: 'mock-sb',
        name: 'mock',
        labels: {},
        process: {executeCommand: mockExecuteCommand},
        delete: mockDelete,
        refreshData: mockRefreshData.mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('SandboxService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('isEnabled', () => {
        it('未配置时返回 false', () => {
            expect(new SandboxService(undefined).isEnabled()).toBe(false);
        });

        it('enabled=false 时返回 false', () => {
            expect(new SandboxService({enabled: false, apiKey: 'k'}).isEnabled()).toBe(false);
        });

        it('有 apiKey 但 enabled 未设置时返回 false', () => {
            expect(new SandboxService({apiKey: 'k'}).isEnabled()).toBe(false);
        });

        it('enabled=true 且有 apiKey 时返回 true', () => {
            expect(new SandboxService({enabled: true, apiKey: 'k'}).isEnabled()).toBe(true);
        });

        it('enabled=true 但无 apiKey 时返回 false', () => {
            expect(new SandboxService({enabled: true}).isEnabled()).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('返回正确的未启用状态', () => {
            const s = new SandboxService(undefined).getStatus();
            expect(s.enabled).toBe(false);
            expect(s.activeCount).toBe(0);
        });

        it('返回已启用状态和自定义 URL', () => {
            const s = new SandboxService({enabled: true, apiKey: 'k', apiUrl: 'https://custom.api'}).getStatus();
            expect(s.enabled).toBe(true);
            expect(s.apiUrl).toBe('https://custom.api');
        });

        it('使用默认 API URL', () => {
            expect(new SandboxService({enabled: false}).getStatus().apiUrl).toBe('https://app.daytona.io');
        });
    });

    describe('getSandbox', () => {
        it('未启用时返回 null', async () => {
            expect(await new SandboxService(undefined).getSandbox('/p')).toBeNull();
        });

        it('创建沙箱成功并缓存', async () => {
            const sb = makeMockSandbox({id: 'sb-1'});
            mockCreate.mockResolvedValue(sb);
            // refreshData 后 state 仍为 started
            mockRefreshData.mockResolvedValue(undefined);

            const service = new SandboxService({enabled: true, apiKey: 'k'});

            const r1 = await service.getSandbox('/workspace/a');
            expect(r1).toBe(sb);
            expect(mockCreate).toHaveBeenCalledTimes(1);

            // 二次调用复用缓存
            const r2 = await service.getSandbox('/workspace/a');
            expect(r2).toBe(sb);
            expect(mockCreate).toHaveBeenCalledTimes(1);
        });

        it('沙箱失效时重新创建', async () => {
            const oldSb = makeMockSandbox({id: 'old', state: 'started'});
            const newSb = makeMockSandbox({id: 'new', state: 'started'});
            mockCreate
                .mockResolvedValueOnce(oldSb)
                .mockResolvedValueOnce(newSb);

            // 首次：state=started → 成功
            mockRefreshData.mockResolvedValueOnce(undefined);
            const service = new SandboxService({enabled: true, apiKey: 'k'});
            await service.getSandbox('/workspace/proj');

            // 二次：refreshData 后 state=destroyed → 重建
            Object.defineProperty(oldSb, 'state', {value: 'destroyed', writable: true});
            mockRefreshData.mockResolvedValueOnce(undefined);

            const result = await service.getSandbox('/workspace/proj');
            expect(result?.id).toBe('new');
            expect(mockCreate).toHaveBeenCalledTimes(2);
        });

        it('创建失败时返回 null', async () => {
            mockCreate.mockRejectedValue(new Error('API error'));

            const service = new SandboxService({enabled: true, apiKey: 'k'});
            expect(await service.getSandbox('/workspace/proj')).toBeNull();
        });
    });

    describe('executeCommand', () => {
        it('未启用时返回 null', async () => {
            expect(await new SandboxService(undefined).executeCommand('/p', 'cmd')).toBeNull();
        });

        it('沙箱不可用时返回 null', async () => {
            mockCreate.mockRejectedValue(new Error('fail'));
            expect(await new SandboxService({enabled: true, apiKey: 'k'}).executeCommand('/p', 'cmd')).toBeNull();
        });

        it('成功执行命令', async () => {
            mockCreate.mockResolvedValue(makeMockSandbox());
            mockRefreshData.mockResolvedValue(undefined);
            mockExecuteCommand.mockResolvedValue({exitCode: 0, result: 'ok'});

            const service = new SandboxService({enabled: true, apiKey: 'k'});
            const result = await service.executeCommand('/workspace/proj', 'npm test', '/workspace/proj');
            expect(result).toEqual({exitCode: 0, stdout: 'ok', stderr: ''});
        });

        it('执行失败时返回 null', async () => {
            mockCreate.mockResolvedValue(makeMockSandbox());
            mockRefreshData.mockResolvedValue(undefined);
            mockExecuteCommand.mockRejectedValue(new Error('timeout'));

            const service = new SandboxService({enabled: true, apiKey: 'k'});
            expect(await service.executeCommand('/p', 'cmd')).toBeNull();
        });
    });

    describe('cleanup', () => {
        it('销毁所有缓存沙箱', async () => {
            mockCreate.mockResolvedValue(makeMockSandbox());
            mockRefreshData.mockResolvedValue(undefined);
            mockDelete.mockResolvedValue(undefined);

            const service = new SandboxService({enabled: true, apiKey: 'k'});
            await service.getSandbox('/workspace/a');
            await service.getSandbox('/workspace/b');
            expect(service.getStatus().activeCount).toBe(2);

            await service.cleanup();
            expect(mockDelete).toHaveBeenCalledTimes(2);
            expect(service.getStatus().activeCount).toBe(0);
        });
    });

    describe('listActive', () => {
        it('未启用时返回空数组', async () => {
            expect(await new SandboxService(undefined).listActive()).toEqual([]);
        });

        it('返回活跃沙箱列表', async () => {
            // list() 返回 PaginatedSandboxes: {items: Sandbox[]}
            mockList.mockResolvedValue({
                items: [
                    {id: 'sb-1', state: 'started', name: 'test-sb', labels: {'aiwb-workspace': '/proj'}},
                    {id: 'sb-2', state: 'stopped', name: 'stopped-sb', labels: {}},
                ],
            });

            const service = new SandboxService({enabled: true, apiKey: 'k'});
            const list = await service.listActive();
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('sb-1');
            expect(list[0].workspacePath).toBe('/proj');
        });

        it('API 失败时返回空数组', async () => {
            mockList.mockRejectedValue(new Error('fail'));
            expect(await new SandboxService({enabled: true, apiKey: 'k'}).listActive()).toEqual([]);
        });
    });
});
