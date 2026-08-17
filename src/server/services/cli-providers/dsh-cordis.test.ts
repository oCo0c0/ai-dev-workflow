/**
 * @file dsh-cordis 单元测试
 * @description 生成器产出的 YAML 组成对齐官方 examples/jsonrpc-agent/cordis.yml
 * （rc.6）：spine 聚合条目、路径参数化、技能/MCP 注入、确定性输出。
 */

import {describe, it, expect} from 'vitest';
import {buildCordisYml, DEFAULT_PERSONA} from './dsh-cordis.js';

describe('buildCordisYml', () => {
    const base = {
        cwd: 'D:\\work\\demo',
        sessionRoot: 'C:\\Users\\me\\.ai-dev-workbench\\dsh\\sessions',
        dshHome: 'C:\\Users\\me\\.ai-dev-workbench\\dsh',
        persona: 'test persona',
    };

    it('包含协议头与核心插件条目（对齐官方组成）', () => {
        const yml = buildCordisYml(base);
        expect(yml).toContain('- id: sdk-jsonrpc-server');
        expect(yml).toContain("'@deepseek-ai/dsh-sdk-jsonrpc-server'");
        expect(yml).toContain('- id: llm-deepseek');
        // spine 聚合条目（内部装载 timer/session/system-prompt/tools/agent/
        // invariants+伴随/agent-loop 等十余插件）
        expect(yml).toContain('- id: agent-spine');
        expect(yml).toContain("'@deepseek-ai/dsh-agent-spine-demo'");
        expect(yml).toContain('- id: tool-fs');
        expect(yml).toContain('- id: compaction-basic');
        expect(yml).toContain('- id: sessions');
        expect(yml).toContain('- id: tool-subagent');
    });

    it('路径与 persona 以 YAML 双引号标量嵌入（反斜杠安全）', () => {
        const yml = buildCordisYml(base);
        // JSON.stringify 产出的转义形态直接断言
        expect(yml).toContain(JSON.stringify(base.cwd));
        expect(yml).toContain(JSON.stringify(base.sessionRoot));
        expect(yml).toContain(JSON.stringify(base.dshHome));
        expect(yml).toContain(JSON.stringify('test persona'));
    });

    it('默认禁用技能栈；显式 skillsDir 时注入 customSkillDirs', () => {
        const without = buildCordisYml(base);
        expect(without).toContain('skills:');
        expect(without).toContain('enabled: false');
        expect(without).not.toContain('customSkillDirs');

        const withSkills = buildCordisYml({...base, skillsDir: 'C:\\skills'});
        expect(withSkills).toContain('enabled: true');
        expect(withSkills).toContain('includeDefaultRoots: false');
        expect(withSkills).toContain(JSON.stringify('C:\\skills'));
    });

    it('MCP 服务器逐个生成条目；空对象时不生成', () => {
        const withMcp = buildCordisYml({
            ...base,
            mcpServers: {
                ones: {command: 'npx', args: ['-y', 'ones-mcp'], env: {TOKEN: 't'}},
                gitlab: {command: 'node', args: ['gitlab-mcp.js']},
            },
        });
        expect(withMcp).toContain('- id: mcp-ones');
        expect(withMcp).toContain('- id: mcp-gitlab');
        expect(withMcp).toContain("'@deepseek-ai/dsh-mcp-client'");
        expect(withMcp).toContain('transport: "stdio"');
        expect(withMcp).toContain('serverName: "ones"');
        expect(withMcp).toContain('command: "npx"');
        expect(withMcp).toContain('TOKEN');

        const noMcp = buildCordisYml({...base, mcpServers: {}});
        expect(noMcp).not.toContain('dsh-mcp-client');
    });

    it('persona 为空时回落默认人格', () => {
        const yml = buildCordisYml({...base, persona: ''});
        expect(yml).toContain(JSON.stringify(DEFAULT_PERSONA));
    });

    it('相同选项产出确定性输出（内容 hash 复用的前提）', () => {
        expect(buildCordisYml(base)).toBe(buildCordisYml({...base}));
    });

    it('stdout 纯净性注释存在（部署铁律）', () => {
        const yml = buildCordisYml(base);
        expect(yml).toContain('stdout');
    });
});
