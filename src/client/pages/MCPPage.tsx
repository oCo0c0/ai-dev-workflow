/**
 * @file MCPPage.tsx
 * @description MCP（Model Context Protocol）服务器配置管理页面。
 *
 * MCP 是一种协议，允许 AI 代理通过标准化接口与外部工具和数据源进行交互。
 * 本页面提供以下功能：
 * - 查看已配置的 MCP 服务器列表及其连接状态
 * - 添加新的 MCP 服务器配置（支持 stdio 和 sse 两种传输类型）
 * - 编辑已有服务器的配置参数（命令、参数、环境变量、启用状态）
 * - 删除不再需要的服务器配置
 * - 测试服务器的连接状态（通过后端 API 发起连接测试）
 *
 * 页面布局：左侧为服务器列表，右侧为编辑/创建表单
 */

import {useState, useEffect, useCallback} from 'react';
import {apiGet, apiPost, apiPut, apiDelete} from '../api';
import {cn} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Card, CardContent} from '../components/ui/card';
import {Badge} from '../components/ui/badge';
import {
    Plus,
    Trash2,
    Plug,
    Loader2,
    Save,
    X,
    Wifi,
    Server,
    AlertCircle,
} from 'lucide-react';

/**
 * MCP 服务器配置接口
 * @description 定义单个 MCP 服务器的完整配置信息
 */
interface MCPServerConfig {
    /** 服务器唯一名称标识 */
    name: string;
    /** 传输协议类型：stdio（标准输入输出）或 sse（Server-Sent Events） */
    type: string;
    /** 启动服务器的可执行命令 */
    command: string;
    /** 传递给命令的参数列表 */
    args: string[];
    /** 环境变量键值对 */
    env: Record<string, string>;
    /** 是否启用该服务器 */
    enabled: boolean;
    /** 连接状态（可选）：已连接、已断开、连接错误 */
    status?: 'connected' | 'disconnected' | 'error';
}

/**
 * MCP 服务器配置管理页面组件
 *
 * @description 提供完整的 MCP 服务器 CRUD 管理界面：
 * - 左侧面板：服务器列表，每个卡片显示名称、状态、命令和操作按钮
 * - 右侧面板：创建/编辑表单，包含名称、类型、命令、参数、环境变量和启用状态配置
 * - 支持连接测试功能，验证服务器是否可正常连接
 * - 错误提示以顶部横幅形式展示
 *
 * @component
 * @example
 * // 在路由中使用
 * <Route path="/mcp" element={<MCPPage />} />
 */
export default function MCPPage() {
    // 服务器列表和加载状态
    const [servers, setServers] = useState<MCPServerConfig[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 编辑和创建模式状态
    const [editing, setEditing] = useState<MCPServerConfig | null>(null); // 当前正在编辑的服务器配置
    const [creating, setCreating] = useState(false); // 是否处于创建模式
    const [testingName, setTestingName] = useState<string | null>(null); // 当前正在测试连接的服务器名称

    // 表单字段状态
    const [formName, setFormName] = useState('');
    const [formType, setFormType] = useState('stdio'); // 默认传输类型为 stdio
    const [formCommand, setFormCommand] = useState('');
    const [formArgs, setFormArgs] = useState(''); // 空格分隔的参数字符串
    const [formEnv, setFormEnv] = useState(''); // 每行一个 KEY=VALUE 格式的环境变量
    const [formEnabled, setFormEnabled] = useState(true); // 默认启用

    /**
     * 从后端 API 获取所有 MCP 服务器配置列表
     */
    const fetchServers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiGet<MCPServerConfig[]>('/mcp-servers');
            setServers(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to fetch MCP servers';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    // 组件挂载时加载服务器列表
    useEffect(() => {
        fetchServers();
    }, [fetchServers]);

    /** 重置所有表单字段到默认值 */
    const resetForm = () => {
        setFormName('');
        setFormType('stdio');
        setFormCommand('');
        setFormArgs('');
        setFormEnv('');
        setFormEnabled(true);
    };

    /**
     * 进入编辑模式，将选中服务器的配置填充到表单中
     * @param server - 要编辑的服务器配置对象
     */
    const startEdit = (server: MCPServerConfig) => {
        setEditing(server);
        setCreating(false);
        setFormName(server.name);
        setFormType(server.type);
        setFormCommand(server.command);
        // 将参数数组转换为空格分隔的字符串用于表单展示
        setFormArgs(server.args.join(' '));
        // 将环境变量对象转换为每行一个 KEY=VALUE 的文本格式
        setFormEnv(Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n'));
        setFormEnabled(server.enabled);
    };

    /** 进入创建模式，清空表单 */
    const startCreate = () => {
        setCreating(true);
        setEditing(null);
        resetForm();
    };

    /** 取消编辑/创建，恢复初始状态 */
    const cancelForm = () => {
        setCreating(false);
        setEditing(null);
        resetForm();
    };

    /**
     * 解析环境变量文本为键值对对象
     * @param envStr - 每行一个 KEY=VALUE 格式的环境变量文本
     * @returns 解析后的环境变量键值对对象
     */
    const parseEnv = (envStr: string): Record<string, string> => {
        const env: Record<string, string> = {};
        envStr.split('\n').filter(Boolean).forEach((line) => {
            const idx = line.indexOf('=');
            if (idx > 0) {
                env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
        });
        return env;
    };

    /**
     * 保存服务器配置（创建或更新）
     * 根据当前模式（creating/editing）调用不同的 API 端点
     */
    const handleSave = async () => {
        // 构建提交数据：将表单字符串字段转换为后端所需的格式
        const payload: MCPServerConfig = {
            name: formName.trim(),
            type: formType,
            command: formCommand.trim(),
            args: formArgs.trim() ? formArgs.trim().split(/\s+/) : [], // 按空格拆分为参数数组
            env: parseEnv(formEnv), // 解析环境变量文本
            enabled: formEnabled,
        };

        try {
            if (creating) {
                // 创建新服务器
                await apiPost('/mcp-servers', payload);
            } else if (editing) {
                // 更新已有服务器（名称作为 URL 路径参数，需 URL 编码）
                await apiPut(`/mcp-servers/${encodeURIComponent(editing.name)}`, payload);
            }
            cancelForm(); // 保存成功后关闭表单
            fetchServers(); // 刷新服务器列表
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save';
            setError(msg);
        }
    };

    /**
     * 删除指定的服务器配置
     * @param name - 要删除的服务器名称
     */
    const handleDelete = async (name: string) => {
        if (!confirm(`Delete server "${name}"?`)) return; // 弹出确认对话框
        try {
            await apiDelete(`/mcp-servers/${encodeURIComponent(name)}`);
            // 如果删除的是当前正在编辑的服务器，则关闭编辑表单
            if (editing?.name === name) cancelForm();
            fetchServers(); // 刷新服务器列表
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to delete';
            setError(msg);
        }
    };

    /**
     * 测试指定服务器的连接状态
     * 通过后端 API 发起连接测试，并根据返回结果更新本地状态
     * @param name - 要测试的服务器名称
     */
    const testConnection = async (name: string) => {
        setTestingName(name); // 标记正在测试的服务器，用于显示加载状态
        try {
            const result = await apiPost<{ status: string; message: string }>(
                `/mcp-servers/${encodeURIComponent(name)}/test`
            );
            // 根据测试结果更新服务器的连接状态
            setServers((prev) =>
                prev.map((s) =>
                    s.name === name
                        ? {...s, status: result.status === 'connected' ? 'connected' : 'error'}
                        : s
                )
            );
        } catch {
            // 测试请求失败时标记该服务器状态为错误
            setServers((prev) =>
                prev.map((s) => (s.name === name ? {...s, status: 'error'} : s))
            );
        } finally {
            setTestingName(null); // 清除测试中标记
        }
    };

    /**
     * 根据连接状态返回对应的指示圆点元素
     * @param status - 连接状态字符串
     * @returns 对应颜色的圆点指示器 JSX 元素
     */
    const statusIcon = (status?: string) => {
        switch (status) {
            case 'connected':
                return <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"/>;
            case 'error':
                return <span className="h-2.5 w-2.5 rounded-full bg-red-500"/>;
            case 'disconnected':
                return <span className="h-2.5 w-2.5 rounded-full bg-amber-500"/>;
            default:
                return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30"/>;
        }
    };

    return (
        <div className="p-6 h-full flex flex-col">
            {/* 全局错误提示横幅 */}
            {error && (
                <div
                    className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            )}

            <div className="flex-1 flex gap-4 min-h-0">
                {/* 左侧面板：MCP 服务器列表 */}
                <div className="w-80 flex flex-col flex-shrink-0">
                    <Button onClick={startCreate} className="w-full mb-3" size="sm">
                        <Plus className="h-4 w-4 mr-1"/>
                        Add Server
                    </Button>
                    <div className="flex-1 overflow-y-auto space-y-2">
                        {/* 加载中状态 */}
                        {loading && (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        )}
                        {/* 空状态：无服务器配置 */}
                        {!loading && servers.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-8 gap-2">
                                <Server className="h-8 w-8 text-muted-foreground/50"/>
                                <p className="text-xs text-muted-foreground">No servers configured</p>
                            </div>
                        )}
                        {/* 渲染每个服务器配置卡片 */}
                        {servers.map((server) => (
                            <Card
                                key={server.name}
                                className={cn(
                                    'cursor-pointer transition-all duration-150 hover:border-primary/50',
                                    // 当前编辑中的服务器卡片高亮显示
                                    editing?.name === server.name && 'border-primary ring-1 ring-primary/20'
                                )}
                                onClick={() => startEdit(server)}
                            >
                                <CardContent className="p-3">
                                    <div className="flex items-center gap-2">
                                        {/* 连接状态指示圆点 */}
                                        {statusIcon(server.status)}
                                        <span className="text-sm font-medium flex-1 truncate">{server.name}</span>
                                        {/* 启用/禁用状态徽章 */}
                                        <Badge variant={server.enabled ? 'success' : 'secondary'}
                                               className="text-[10px]">
                                            {server.enabled ? 'ON' : 'OFF'}
                                        </Badge>
                                    </div>
                                    {/* 显示启动命令和参数 */}
                                    <p className="text-xs text-muted-foreground mt-1.5 truncate font-mono">
                                        {server.command} {server.args.join(' ')}
                                    </p>
                                    {/* 操作按钮：测试连接和删除 */}
                                    <div className="mt-2.5 flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                testConnection(server.name);
                                            }}
                                            disabled={testingName === server.name} // 测试中时禁用按钮
                                        >
                                            {testingName === server.name ? (
                                                <Loader2 className="h-3 w-3 animate-spin mr-1"/>
                                            ) : (
                                                <Wifi className="h-3 w-3 mr-1"/>
                                            )}
                                            Test
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs text-destructive hover:text-destructive"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(server.name);
                                            }}
                                        >
                                            <Trash2 className="h-3 w-3 mr-1"/>
                                            Delete
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>

                {/* 右侧面板：创建/编辑表单 */}
                {(creating || editing) && (
                    <Card className="flex-1 overflow-y-auto">
                        <div className="p-4">
                            {/* 表单标题：根据模式显示不同的标题 */}
                            <h3 className="text-sm font-medium mb-4">
                                {creating ? 'Add New Server' : `Edit: ${editing?.name}`}
                            </h3>
                            <div className="space-y-4">
                                {/* 服务器名称（编辑模式下不可修改） */}
                                <div>
                                    <label
                                        className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
                                    <Input
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        disabled={!!editing} // 编辑模式下名称不可更改
                                    />
                                </div>
                                {/* 传输类型选择：stdio 或 sse */}
                                <div>
                                    <label
                                        className="block text-xs font-medium text-muted-foreground mb-1.5">Type</label>
                                    <select
                                        value={formType}
                                        onChange={(e) => setFormType(e.target.value)}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        <option value="stdio">stdio</option>
                                        <option value="sse">sse</option>
                                    </select>
                                </div>
                                {/* 启动命令 */}
                                <div>
                                    <label
                                        className="block text-xs font-medium text-muted-foreground mb-1.5">Command</label>
                                    <Input
                                        value={formCommand}
                                        onChange={(e) => setFormCommand(e.target.value)}
                                        placeholder="e.g., npx -y @ones/mcp-server"
                                    />
                                </div>
                                {/* 命令参数（空格分隔） */}
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Arguments
                                        (space-separated)</label>
                                    <Input
                                        value={formArgs}
                                        onChange={(e) => setFormArgs(e.target.value)}
                                        placeholder="e.g., --port 3000"
                                    />
                                </div>
                                {/* 环境变量（每行一个 KEY=VALUE） */}
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Environment
                                        Variables (KEY=VALUE per line)</label>
                                    <textarea
                                        value={formEnv}
                                        onChange={(e) => setFormEnv(e.target.value)}
                                        placeholder={"API_KEY=xxx\nBASE_URL=https://..."}
                                        rows={4}
                                        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                                    />
                                </div>
                                {/* 启用/禁用开关 */}
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={formEnabled}
                                        onChange={(e) => setFormEnabled(e.target.checked)}
                                        className="rounded border-input"
                                        id="enabled-check"
                                    />
                                    <label htmlFor="enabled-check" className="text-sm">Enabled</label>
                                </div>
                                {/* 表单操作按钮：保存和取消 */}
                                <div className="flex gap-2 pt-2">
                                    <Button onClick={handleSave} size="sm">
                                        <Save className="h-4 w-4 mr-1"/>
                                        {creating ? 'Create' : 'Save'}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={cancelForm}>
                                        <X className="h-4 w-4 mr-1"/>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                )}

                {/* 未选中任何服务器时的空状态提示 */}
                {!creating && !editing && (
                    <Card className="flex-1 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <Plug className="h-10 w-10 text-muted-foreground/30"/>
                            <p className="text-sm text-muted-foreground">Select a server to edit or add a new one</p>
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
