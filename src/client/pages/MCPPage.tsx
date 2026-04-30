import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
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

interface MCPServerConfig {
  name: string;
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  status?: 'connected' | 'disconnected' | 'error';
}

export default function MCPPage() {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MCPServerConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [testingName, setTestingName] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);

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

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const resetForm = () => {
    setFormName('');
    setFormType('stdio');
    setFormCommand('');
    setFormArgs('');
    setFormEnv('');
    setFormEnabled(true);
  };

  const startEdit = (server: MCPServerConfig) => {
    setEditing(server);
    setCreating(false);
    setFormName(server.name);
    setFormType(server.type);
    setFormCommand(server.command);
    setFormArgs(server.args.join(' '));
    setFormEnv(Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n'));
    setFormEnabled(server.enabled);
  };

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    resetForm();
  };

  const cancelForm = () => {
    setCreating(false);
    setEditing(null);
    resetForm();
  };

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

  const handleSave = async () => {
    const payload: MCPServerConfig = {
      name: formName.trim(),
      type: formType,
      command: formCommand.trim(),
      args: formArgs.trim() ? formArgs.trim().split(/\s+/) : [],
      env: parseEnv(formEnv),
      enabled: formEnabled,
    };

    try {
      if (creating) {
        await apiPost('/mcp-servers', payload);
      } else if (editing) {
        await apiPut(`/mcp-servers/${encodeURIComponent(editing.name)}`, payload);
      }
      cancelForm();
      fetchServers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete server "${name}"?`)) return;
    try {
      await apiDelete(`/mcp-servers/${encodeURIComponent(name)}`);
      if (editing?.name === name) cancelForm();
      fetchServers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete';
      setError(msg);
    }
  };

  const testConnection = async (name: string) => {
    setTestingName(name);
    try {
      const result = await apiPost<{ status: string; message: string }>(
        `/mcp-servers/${encodeURIComponent(name)}/test`
      );
      setServers((prev) =>
        prev.map((s) =>
          s.name === name
            ? { ...s, status: result.status === 'connected' ? 'connected' : 'error' }
            : s
        )
      );
    } catch {
      setServers((prev) =>
        prev.map((s) => (s.name === name ? { ...s, status: 'error' } : s))
      );
    } finally {
      setTestingName(null);
    }
  };

  const statusIcon = (status?: string) => {
    switch (status) {
      case 'connected': return <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />;
      case 'error': return <span className="h-2.5 w-2.5 rounded-full bg-red-500" />;
      case 'disconnected': return <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />;
      default: return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />;
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Error */}
      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Server List */}
        <div className="w-80 flex flex-col flex-shrink-0">
          <Button onClick={startCreate} className="w-full mb-3" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Server
          </Button>
          <div className="flex-1 overflow-y-auto space-y-2">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && servers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Server className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">No servers configured</p>
              </div>
            )}
            {servers.map((server) => (
              <Card
                key={server.name}
                className={cn(
                  'cursor-pointer transition-all duration-150 hover:border-primary/50',
                  editing?.name === server.name && 'border-primary ring-1 ring-primary/20'
                )}
                onClick={() => startEdit(server)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    {statusIcon(server.status)}
                    <span className="text-sm font-medium flex-1 truncate">{server.name}</span>
                    <Badge variant={server.enabled ? 'success' : 'secondary'} className="text-[10px]">
                      {server.enabled ? 'ON' : 'OFF'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 truncate font-mono">
                    {server.command} {server.args.join(' ')}
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => { e.stopPropagation(); testConnection(server.name); }}
                      disabled={testingName === server.name}
                    >
                      {testingName === server.name ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Wifi className="h-3 w-3 mr-1" />
                      )}
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDelete(server.name); }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Form */}
        {(creating || editing) && (
          <Card className="flex-1 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-medium mb-4">
                {creating ? 'Add New Server' : `Edit: ${editing?.name}`}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    disabled={!!editing}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="stdio">stdio</option>
                    <option value="sse">sse</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Command</label>
                  <Input
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    placeholder="e.g., npx -y @ones/mcp-server"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Arguments (space-separated)</label>
                  <Input
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                    placeholder="e.g., --port 3000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Environment Variables (KEY=VALUE per line)</label>
                  <textarea
                    value={formEnv}
                    onChange={(e) => setFormEnv(e.target.value)}
                    placeholder={"API_KEY=xxx\nBASE_URL=https://..."}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  />
                </div>
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
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleSave} size="sm">
                    <Save className="h-4 w-4 mr-1" />
                    {creating ? 'Create' : 'Save'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelForm}>
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {!creating && !editing && (
          <Card className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Plug className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Select a server to edit or add a new one</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
