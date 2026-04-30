import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import crypto from 'crypto';

const BRIDGE_SCRIPT = path.resolve(process.cwd(), 'src/bridge/claude-bridge.mjs');

// === Data Models ===

export interface CLIRunnerOptions {
  workspacePath: string;
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  signal?: AbortSignal;
}

export interface CLIVersionInfo {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface CLIExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  aborted: boolean;
  sessionId?: string;
}

interface PendingRequest {
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  resolve: (result: CLIExecutionResult) => void;
  reject: (err: Error) => void;
  stdout: string;
  sessionId?: string;
  aborted: boolean;
  abortHandler?: () => void;
}

// === Persistent Bridge Process Manager ===

class BridgeProcess {
  private process: ChildProcess | null = null;
  private ready = false;
  private buffer = '';
  private pendingRequests = new Map<string, PendingRequest>();
  private readyCallbacks: Array<() => void> = [];
  private startPromise: Promise<void> | null = null;

  async ensureStarted(): Promise<void> {
    if (this.ready && this.process) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.start();
    return this.startPromise;
  }

  private start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [BRIDGE_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.process = child;

      const timeout = setTimeout(() => {
        reject(new Error('Bridge process failed to start within 30 seconds'));
        child.kill();
      }, 30000);

      child.stdout.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            this.handleMessage(JSON.parse(line));
          } catch {
            // ignore non-JSON
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        // Forward stderr to all pending requests as errors
        for (const req of this.pendingRequests.values()) {
          req.onError?.(text);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.ready = false;
        this.process = null;
        this.startPromise = null;
        // Reject all pending requests
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error(`Bridge process error: ${err.message}`));
          this.pendingRequests.delete(id);
        }
        reject(err);
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        this.ready = false;
        this.process = null;
        this.startPromise = null;
        // Reject all pending requests
        for (const [id, req] of this.pendingRequests) {
          req.reject(new Error(`Bridge process exited with code ${code}`));
          this.pendingRequests.delete(id);
        }
      });

      // Wait for 'ready' message
      this.readyCallbacks.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>) {
    // Handle ready signal
    if (msg.type === 'ready') {
      this.ready = true;
      this.startPromise = null;
      for (const cb of this.readyCallbacks) cb();
      this.readyCallbacks = [];
      return;
    }

    const requestId = msg.requestId as string;
    if (!requestId) return;

    const req = this.pendingRequests.get(requestId);
    if (!req) return;

    switch (msg.type) {
      case 'output':
        if (msg.content) {
          req.stdout += msg.content as string;
          req.onOutput?.(msg.content as string);
        }
        break;

      case 'session':
        if (msg.sessionId) {
          req.sessionId = msg.sessionId as string;
        }
        break;

      case 'error':
        req.onError?.(msg.message as string || 'Unknown error');
        this.pendingRequests.delete(requestId);
        req.resolve({
          exitCode: 1,
          stdout: req.stdout,
          stderr: msg.message as string || '',
          aborted: req.aborted,
          sessionId: req.sessionId,
        });
        break;

      case 'done':
        this.pendingRequests.delete(requestId);
        req.resolve({
          exitCode: (msg.exitCode as number) ?? 0,
          stdout: req.stdout,
          stderr: '',
          aborted: req.aborted,
          sessionId: req.sessionId,
        });
        break;
    }
  }

  async send(
    input: { prompt: string; cwd?: string; sessionId?: string; maxTurns?: number; skills?: string[] | 'all' },
    options?: CLIRunnerOptions
  ): Promise<CLIExecutionResult> {
    await this.ensureStarted();

    if (!this.process || !this.ready) {
      throw new Error('Bridge process is not ready');
    }

    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const req: PendingRequest = {
        onOutput: options?.onOutput,
        onError: options?.onError,
        resolve,
        reject,
        stdout: '',
        aborted: false,
      };

      // Handle abort signal
      if (options?.signal) {
        if (options.signal.aborted) {
          resolve({ exitCode: null, stdout: '', stderr: '', aborted: true });
          return;
        }
        const abortHandler = () => {
          req.aborted = true;
          this.pendingRequests.delete(requestId);
          resolve({ exitCode: null, stdout: req.stdout, stderr: '', aborted: true });
        };
        req.abortHandler = abortHandler;
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.pendingRequests.set(requestId, req);

      // Send request to bridge
      const message = JSON.stringify({ requestId, ...input }) + '\n';
      const proc = this.process;
      if (proc && proc.stdin) {
        proc.stdin.write(message);
      } else {
        this.pendingRequests.delete(requestId);
        reject(new Error('Bridge process stdin not available'));
      }
    });
  }

  kill() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.ready = false;
    }
  }

  isReady() {
    return this.ready && this.process !== null;
  }
}

// Singleton bridge process
const bridgeProcess = new BridgeProcess();

// === CLI Runner Service ===

export class CLIRunnerService {
  constructor() {
    // Pre-warm the bridge process on service creation
    bridgeProcess.ensureStarted().catch(() => {
      // Will retry on first actual request
    });
  }

  async checkAvailability(): Promise<CLIVersionInfo> {
    try {
      await bridgeProcess.ensureStarted();
      return { available: true, version: 'claude-agent-sdk (persistent)', path: BRIDGE_SCRIPT };
    } catch (err) {
      return { available: false, error: (err as Error).message };
    }
  }

  async runBridge(
    input: { prompt: string; cwd?: string; sessionId?: string; maxTurns?: number; skills?: string[] | 'all' },
    options?: CLIRunnerOptions
  ): Promise<CLIExecutionResult> {
    return bridgeProcess.send(input, options);
  }

}
