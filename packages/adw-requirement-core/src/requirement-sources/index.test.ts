/**
 * @file 需求源适配器注册表单元测试
 * @description 覆盖：
 *              1. resolveAdapter 自动路由（ones/github 认领、未知配置落 generic、显式绑定优先）
 *              2. ONES 适配器：输入方言规整、编号提取、详情参数构建
 *              3. GitHub 适配器：输入方言、仓库补全、JSON 解析（state/user.login/body 映射）
 *              4. generic 适配器：JSON 与 Markdown 兜底解析
 *              全部为纯函数测试，不启动 MCP 服务器。
 */

import {describe, it, expect} from 'vitest';
import type {MCPServerConfig} from '../mcp-config.js';
import {resolveAdapter, bindServer, unbindServer, getAdapter, listAdapters, listCatalogAdapters} from './index.js';

/** 构造 MCP server 配置的测试工厂 */
function makeConfig(overrides: Partial<MCPServerConfig> & {name: string}): MCPServerConfig {
    return {
        type: 'custom',
        command: 'npx',
        args: [],
        env: {},
        enabled: true,
        ...overrides,
    };
}

describe('requirement-sources registry', () => {
    it('claims the real-world ones-api server (ai-dev-requirements package, no "ones" in command)', () => {
        // 真实注册条目：命令是 ai-dev-requirements@latest（不含 "ones"），靠服务器名 + 包名认领
        const config = makeConfig({
            name: 'ones-api',
            command: 'cmd',
            args: ['/c', 'npx', '-y', 'ai-dev-requirements@latest'],
        });
        expect(resolveAdapter('ones-api', config).id).toBe('ones');
    });

    it('claims ones-like packages by command even with a neutral server name', () => {
        const config = makeConfig({name: 'my-tracker', command: 'npx', args: ['-y', 'ones-mcp']});
        expect(resolveAdapter('my-tracker', config).id).toBe('ones');
    });

    it('routes github-like server config to github adapter', () => {
        const config = makeConfig({name: 'gh-tools', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github']});
        expect(resolveAdapter('gh-tools', config).id).toBe('github');
        // 服务器名含 github 也认领
        const byName = makeConfig({name: 'github', command: 'npx', args: ['-y', 'some-wrapper']});
        expect(resolveAdapter('github', byName).id).toBe('github');
    });

    it('falls back to generic adapter for unrecognized servers', () => {
        const config = makeConfig({name: 'jira-x', command: 'jira-mcp-wrapper'});
        const adapter = resolveAdapter('jira-x', config);
        expect(adapter.id).toBe('generic');
    });

    it('falls back to generic when config is missing', () => {
        expect(resolveAdapter('whatever', undefined).id).toBe('generic');
    });

    it('explicit binding overrides auto-detection', () => {
        const config = makeConfig({name: 'my-jira', command: 'jira-mcp-wrapper'});
        bindServer('my-jira', 'github');
        expect(resolveAdapter('my-jira', config).id).toBe('github');
        unbindServer('my-jira');
        expect(resolveAdapter('my-jira', config).id).toBe('generic');
    });

    it('registers builtin adapters plus generic in the catalog', () => {
        const ids = listAdapters().map(a => a.id);
        expect(ids).toContain('ones');
        expect(ids).toContain('github');
        expect(ids).toContain('generic');
    });

    it('catalog view excludes the generic fallback', () => {
        const ids = listCatalogAdapters().map(a => a.id);
        expect(ids).toContain('ones');
        expect(ids).toContain('github');
        expect(ids).not.toContain('generic');
    });

    it('adapters carry catalog metadata and install templates', () => {
        const ones = getAdapter('ones')!;
        expect(ones.description.length).toBeGreaterThan(0);
        expect(ones.installTemplate?.serverName).toBe('ones-api');
        expect(ones.installTemplate?.envSpecs.some(s => s.key === 'ONES_PASSWORD')).toBe(true);
        const github = getAdapter('github')!;
        expect(github.installTemplate?.serverName).toBe('github');
        expect(github.installTemplate?.envSpecs.every(s => typeof s.secret === 'boolean' || s.secret === undefined)).toBe(true);
    });

    it('exposes adapters by id including generic', () => {
        expect(getAdapter('generic')?.id).toBe('generic');
        expect(getAdapter('ones')?.id).toBe('ones');
        expect(getAdapter('nope')).toBeUndefined();
    });
});

describe('OnesAdapter', () => {
    const adapter = getAdapter('ones')!;

    it('normalizes input dialects', () => {
        expect(adapter.normalizeInput('#302')).toBe('302');
        expect(adapter.normalizeInput('CWXT-129686')).toBe('129686');
        // ONES 链接原样透传（含 team 标识可唯一定位）
        expect(adapter.normalizeInput('https://1s.oristand.com/wiki#/team/x/page/y')).toBe('https://1s.oristand.com/wiki#/team/x/page/y');
        // uuid 原样
        expect(adapter.normalizeInput('RbSvp3zzkJyHJ47Y')).toBe('RbSvp3zzkJyHJ47Y');
    });

    it('extracts plain numbers only from numeric forms', () => {
        expect(adapter.extractPlainNumber('302')).toBe('302');
        expect(adapter.extractPlainNumber('RbSvp3zz')).toBeUndefined();
    });

    it('builds detail args with id', () => {
        expect(adapter.buildDetailArgs('302')).toEqual({id: '302'});
    });

    it('creates image service only with complete ONES env', () => {
        expect(adapter.createImageService(makeConfig({name: 'x', env: {}}))).toBeUndefined();
        expect(adapter.createImageService(makeConfig({
            name: 'x',
            env: {ONES_API_BASE: 'https://ones', ONES_ACCOUNT: 'a@b.c', ONES_PASSWORD: 'p'},
        }))).toBeDefined();
    });
});

describe('GithubAdapter', () => {
    const adapter = getAdapter('github')!;

    it('normalizes input dialects', () => {
        expect(adapter.normalizeInput('https://github.com/foo/bar/issues/42')).toBe('foo/bar#42');
        expect(adapter.normalizeInput('foo/bar#42')).toBe('foo/bar#42');
        expect(adapter.normalizeInput('#42')).toBe('42');
    });

    it('builds detail args with owner/repo when input carries them', () => {
        expect(adapter.buildDetailArgs('foo/bar#42')).toEqual({owner: 'foo', repo: 'bar', issue_number: 42});
    });

    it('falls back to GITHUB_REPOSITORY env for bare numbers', () => {
        const config = makeConfig({name: 'gh', env: {GITHUB_REPOSITORY: 'foo/bar'}});
        expect(adapter.buildDetailArgs('42', config)).toEqual({owner: 'foo', repo: 'bar', issue_number: 42});
    });

    it('throws a helpful error for bare numbers without default repo', () => {
        expect(() => adapter.buildDetailArgs('42', makeConfig({name: 'gh'}))).toThrow(/owner\/repo/);
    });

    it('parses issue detail JSON into neutral model', () => {
        const content = [{type: 'text', text: JSON.stringify({
            number: 42,
            title: 'Fix login',
            state: 'open',
            body: 'Steps:\n- [ ] reproduce\n- [ ] fix\n\n![shot](https://x/img.png)',
            user: {login: 'alice'},
            assignee: {login: 'bob'},
            updated_at: '2026-01-02T03:04:05Z',
            labels: [{name: 'P0'}],
        })}];
        const detail = adapter.parseDetail(content);
        expect(detail.id).toBe('42');
        expect(detail.number).toBe('#42');
        expect(detail.status).toBe('open');
        expect(detail.priority).toBe('high');
        expect(detail.assignee).toBe('bob');
        expect(detail.acceptanceCriteria).toEqual(['reproduce', 'fix']);
        expect(detail.attachments).toHaveLength(1);
        expect(detail.attachments[0].url).toBe('https://x/img.png');
    });

    it('parses search results from bare array and wrapped items', () => {
        const bare = [{type: 'text', text: JSON.stringify([{number: 1, title: 'A', state: 'open', user: {login: 'u'}}])}];
        expect(adapter.parseList(bare)).toHaveLength(1);
        const wrapped = [{type: 'text', text: JSON.stringify({items: [{number: 2, title: 'B', state: 'closed'}]})}];
        const list = adapter.parseList(wrapped);
        expect(list[0].id).toBe('2');
        expect(list[0].status).toBe('closed');
    });

    it('never claims attachment image service', () => {
        expect(adapter.createImageService(makeConfig({name: 'gh'}))).toBeUndefined();
    });
});

describe('GenericAdapter', () => {
    const adapter = getAdapter('generic')!;

    it('never claims servers', () => {
        expect(adapter.matchServer(makeConfig({name: 'anything', command: 'ones'}))).toBe(false);
    });

    it('parses JSON list', () => {
        const content = [{type: 'text', text: JSON.stringify([{id: '1', title: 'T', status: 'open'}])}];
        const list = adapter.parseList(content);
        expect(list).toHaveLength(1);
        expect(list[0].title).toBe('T');
    });

    it('parses markdown detail with neutral sections', () => {
        const md = '# #99 Title\n- **ID**: xyz\n- **Status**: open\n\n## Description\n\nhello world\n';
        const detail = adapter.parseDetail([{type: 'text', text: md}]);
        expect(detail.id).toBe('xyz');
        expect(detail.description).toContain('hello world');
    });
});
