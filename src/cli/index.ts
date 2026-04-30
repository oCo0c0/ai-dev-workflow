import { findAvailablePort } from './port-finder.js';
import { printBanner } from './banner.js';
import { createServer } from '../server/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface AppConfig {
  server?: {
    port?: number;
    host?: string;
  };
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // Ignore parse errors, use defaults
  }
  return {};
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function getVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

async function startCLI(): Promise<void> {
  ensureConfigDir();

  const config = loadConfig();
  const preferredPort = config.server?.port;

  const { port } = await findAvailablePort({ preferredPort });
  const version = getVersion();

  const server = await createServer(port);

  printBanner(port, version);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n  Shutting down...');
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startCLI().catch((err) => {
  console.error('Failed to start AI Dev Workbench:', err.message);
  process.exit(1);
});
