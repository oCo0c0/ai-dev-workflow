import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

export interface MCPServerConfig {
  name: string;
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  status?: 'connected' | 'disconnected' | 'error';
}

interface ClaudeSettingsFile {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  [key: string]: unknown;
}

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

export class MCPConfigService {
  private settingsFile: string;
  private claudeDir: string;

  constructor(settingsFile?: string) {
    this.settingsFile = settingsFile ?? SETTINGS_FILE;
    this.claudeDir = path.dirname(this.settingsFile);
  }

  /**
   * Ensures the claude directory exists.
   */
  private ensureClaudeDir(): void {
    if (!fs.existsSync(this.claudeDir)) {
      fs.mkdirSync(this.claudeDir, { recursive: true });
    }
  }

  /**
   * Load the Claude settings file.
   */
  private loadSettings(): ClaudeSettingsFile {
    if (!fs.existsSync(this.settingsFile)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.settingsFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return {};
      }
      return parsed as ClaudeSettingsFile;
    } catch {
      return {};
    }
  }

  /**
   * Save the Claude settings file, preserving other fields.
   */
  private saveSettings(settings: ClaudeSettingsFile): void {
    this.ensureClaudeDir();
    fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  }

  /**
   * List all configured MCP servers.
   */
  list(): MCPServerConfig[] {
    const settings = this.loadSettings();
    const mcpServers = settings.mcpServers ?? {};
    const configs: MCPServerConfig[] = [];

    for (const [name, config] of Object.entries(mcpServers)) {
      configs.push({
        name,
        type: this.inferType(config.command, config.args),
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {},
        enabled: true,
        status: 'disconnected',
      });
    }

    return configs;
  }

  /**
   * Get a single MCP server config by name.
   */
  get(name: string): MCPServerConfig | undefined {
    const settings = this.loadSettings();
    const mcpServers = settings.mcpServers ?? {};
    const config = mcpServers[name];

    if (!config) {
      return undefined;
    }

    return {
      name,
      type: this.inferType(config.command, config.args),
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
      enabled: true,
      status: 'disconnected',
    };
  }

  /**
   * Add a new MCP server configuration.
   */
  add(config: MCPServerConfig): MCPServerConfig {
    if (!config.name || config.name.trim() === '') {
      throw new Error('MCP Server name is required');
    }

    if (!config.command || config.command.trim() === '') {
      throw new Error('MCP Server command is required');
    }

    const settings = this.loadSettings();
    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }

    if (settings.mcpServers[config.name]) {
      throw new Error(`MCP Server "${config.name}" already exists`);
    }

    settings.mcpServers[config.name] = {
      command: config.command,
      args: config.args.length > 0 ? config.args : undefined,
      env: Object.keys(config.env).length > 0 ? config.env : undefined,
    };

    this.saveSettings(settings);

    return {
      ...config,
      type: this.inferType(config.command, config.args),
      status: 'disconnected',
    };
  }

  /**
   * Update an existing MCP server configuration.
   */
  update(name: string, config: Partial<Omit<MCPServerConfig, 'name'>>): MCPServerConfig {
    const settings = this.loadSettings();
    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }

    if (!settings.mcpServers[name]) {
      throw new Error(`MCP Server "${name}" not found`);
    }

    const existing = settings.mcpServers[name];

    const updatedCommand = config.command ?? existing.command;
    const updatedArgs = config.args ?? existing.args ?? [];
    const updatedEnv = config.env ?? existing.env ?? {};

    settings.mcpServers[name] = {
      command: updatedCommand,
      args: updatedArgs.length > 0 ? updatedArgs : undefined,
      env: Object.keys(updatedEnv).length > 0 ? updatedEnv : undefined,
    };

    this.saveSettings(settings);

    return {
      name,
      type: this.inferType(updatedCommand, updatedArgs),
      command: updatedCommand,
      args: updatedArgs,
      env: updatedEnv,
      enabled: config.enabled ?? true,
      status: 'disconnected',
    };
  }

  /**
   * Delete an MCP server configuration.
   */
  delete(name: string): boolean {
    const settings = this.loadSettings();
    if (!settings.mcpServers || !settings.mcpServers[name]) {
      return false;
    }

    delete settings.mcpServers[name];
    this.saveSettings(settings);
    return true;
  }

  /**
   * Test connection to an MCP server by spawning its command and checking if it starts.
   * Returns a promise that resolves with the connection status.
   */
  testConnection(name: string, timeoutMs: number = 5000): Promise<{ status: 'connected' | 'error'; message: string }> {
    const config = this.get(name);
    if (!config) {
      return Promise.resolve({ status: 'error', message: `MCP Server "${name}" not found` });
    }

    return new Promise((resolve) => {
      try {
        const child = spawn(config.command, config.args, {
          env: { ...process.env, ...config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });

        let resolved = false;

        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            // Process started and is still running after timeout — consider it connected
            child.kill();
            resolve({ status: 'connected', message: 'MCP Server started successfully' });
          }
        }, timeoutMs);

        child.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve({ status: 'error', message: `Failed to start: ${err.message}` });
          }
        });

        child.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            if (code === 0) {
              resolve({ status: 'connected', message: 'MCP Server exited cleanly' });
            } else {
              resolve({ status: 'error', message: `Process exited with code ${code}` });
            }
          }
        });
      } catch (err) {
        resolve({ status: 'error', message: `Failed to spawn process: ${(err as Error).message}` });
      }
    });
  }

  /**
   * Get the list of available MCP server names (for pipeline validation).
   */
  getServerNames(): string[] {
    return this.list().map(s => s.name);
  }

  /**
   * Returns the settings file path.
   */
  getSettingsFile(): string {
    return this.settingsFile;
  }

  /**
   * Infer the server type from the command and args.
   */
  private inferType(command: string, args?: string[]): string {
    const allParts = [command, ...(args ?? [])].join(' ').toLowerCase();

    if (allParts.includes('npx') || allParts.includes('node') || allParts.includes('.js')) {
      return 'node';
    }
    if (allParts.includes('python') || allParts.includes('.py')) {
      return 'python';
    }
    if (allParts.includes('docker')) {
      return 'docker';
    }

    return 'custom';
  }
}
