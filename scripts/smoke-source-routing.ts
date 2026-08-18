/**
 * 一次性冒烟脚本：对用户真实注册表（~/.ai-dev-workbench/mcp-servers.json）
 * 逐一解析适配器路由，并打印源目录（listSources 的输出形态）。
 */
import {MCPRegistryService} from '../src/server/services/mcp-registry-service.js';
import {resolveAdapter, listCatalogAdapters} from '../src/server/services/requirement-sources/index.js';

const registry = new MCPRegistryService();
const servers = registry.list();

console.log('=== 逐服务器路由 ===');
for (const s of servers) {
    console.log(`${s.name.padEnd(18)} ${s.command} ${(s.args ?? []).join(' ')}\n  → ${resolveAdapter(s.name, s).id}`);
}

console.log('\n=== 源目录（GET /api/requirements/sources）===');
for (const adapter of listCatalogAdapters()) {
    const servers2 = servers.filter(s => resolveAdapter(s.name, s).id === adapter.id).map(s => s.name);
    console.log(`${adapter.label}: servers=[${servers2.join(', ')}]${servers2.length === 0 ? '  ← 未配置' : ''}`);
}
