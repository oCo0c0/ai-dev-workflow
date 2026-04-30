import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.ai-dev-workbench', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeLog(entry: string): void {
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, entry + '\n');
  } catch {
    // Silently fail if logging is not possible
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
    writeLog(entry);
  });

  next();
}
