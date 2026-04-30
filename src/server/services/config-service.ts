import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AppConfig {
  server?: {
    port?: number;
    host?: string;
  };
  claudeCodeCli?: {
    path?: string;
  };
  ui?: {
    theme?: 'dark' | 'light';
    sidebarCollapsed?: boolean;
  };
  defaultPipelineId?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  server: {
    host: 'localhost',
  },
  claudeCodeCli: {
    path: 'claude',
  },
  ui: {
    theme: 'dark',
    sidebarCollapsed: false,
  },
};

export interface ConfigValidationError {
  field: string;
  message: string;
}

/**
 * Validates that a parsed config object has correct field types.
 * Returns an array of validation errors (empty if valid).
 */
export function validateConfig(config: unknown): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (config === null || typeof config !== 'object') {
    errors.push({ field: 'root', message: 'Config must be a non-null object' });
    return errors;
  }

  const obj = config as Record<string, unknown>;

  if (obj.server !== undefined) {
    if (typeof obj.server !== 'object' || obj.server === null) {
      errors.push({ field: 'server', message: 'server must be an object' });
    } else {
      const server = obj.server as Record<string, unknown>;
      if (server.port !== undefined && (typeof server.port !== 'number' || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535)) {
        errors.push({ field: 'server.port', message: 'server.port must be an integer between 1 and 65535' });
      }
      if (server.host !== undefined && typeof server.host !== 'string') {
        errors.push({ field: 'server.host', message: 'server.host must be a string' });
      }
    }
  }

  if (obj.claudeCodeCli !== undefined) {
    if (typeof obj.claudeCodeCli !== 'object' || obj.claudeCodeCli === null) {
      errors.push({ field: 'claudeCodeCli', message: 'claudeCodeCli must be an object' });
    } else {
      const cli = obj.claudeCodeCli as Record<string, unknown>;
      if (cli.path !== undefined && typeof cli.path !== 'string') {
        errors.push({ field: 'claudeCodeCli.path', message: 'claudeCodeCli.path must be a string' });
      }
    }
  }

  if (obj.ui !== undefined) {
    if (typeof obj.ui !== 'object' || obj.ui === null) {
      errors.push({ field: 'ui', message: 'ui must be an object' });
    } else {
      const ui = obj.ui as Record<string, unknown>;
      if (ui.theme !== undefined && ui.theme !== 'dark' && ui.theme !== 'light') {
        errors.push({ field: 'ui.theme', message: 'ui.theme must be "dark" or "light"' });
      }
      if (ui.sidebarCollapsed !== undefined && typeof ui.sidebarCollapsed !== 'boolean') {
        errors.push({ field: 'ui.sidebarCollapsed', message: 'ui.sidebarCollapsed must be a boolean' });
      }
    }
  }

  if (obj.defaultPipelineId !== undefined && typeof obj.defaultPipelineId !== 'string') {
    errors.push({ field: 'defaultPipelineId', message: 'defaultPipelineId must be a string' });
  }

  return errors;
}

export class ConfigService {
  private configDir: string;
  private configFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? CONFIG_DIR;
    this.configFile = path.join(this.configDir, 'config.json');
  }

  /**
   * Ensures the config directory exists. Creates it if missing.
   */
  ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * Loads the config from disk. If the file doesn't exist, creates it with defaults.
   * If the file contains invalid JSON, throws an error.
   */
  load(): AppConfig {
    this.ensureConfigDir();

    if (!fs.existsSync(this.configFile)) {
      this.save(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }

    const raw = fs.readFileSync(this.configFile, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Config file contains invalid JSON');
    }

    const errors = validateConfig(parsed);
    if (errors.length > 0) {
      throw new Error(`Config validation failed: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`);
    }

    return parsed as AppConfig;
  }

  /**
   * Saves the config to disk after validation.
   * Rejects invalid configs without modifying the file.
   */
  save(config: AppConfig): void {
    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Config validation failed: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`);
    }

    this.ensureConfigDir();
    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Returns the path to the config directory.
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Returns the path to the config file.
   */
  getConfigFile(): string {
    return this.configFile;
  }

  /**
   * Returns the default config.
   */
  getDefaultConfig(): AppConfig {
    return { ...DEFAULT_CONFIG };
  }
}
