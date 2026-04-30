#!/usr/bin/env node
/**
 * Claude Bridge - Persistent Node.js process that uses @anthropic-ai/claude-agent-sdk.
 *
 * Runs in persistent mode: reads JSON requests from stdin line by line,
 * writes JSON responses to stdout line by line.
 *
 * Request format (one JSON per line):
 *   { requestId, prompt, cwd, sessionId?, maxTurns?, skills? }
 *
 * Response format (multiple JSON lines per request, identified by requestId):
 *   { requestId, type: 'output', content: '...' }
 *   { requestId, type: 'session', sessionId: '...' }
 *   { requestId, type: 'done', exitCode: 0 }
 *   { requestId, type: 'error', message: '...' }
 */

// Configure CLI identity BEFORE importing SDK
process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
process.env.USER_TYPE = 'external';
delete process.env.CLAUDE_AGENT_SDK_VERSION;

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import readline from 'readline';

// Resolve the path to the actual Claude CLI entry point (cli.js)
function resolveClaudeCliPath() {
  const candidates = [
    join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    join('D:', 'javaSE', 'nvm', 'nodejs', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  try {
    const require = createRequire(import.meta.url);
    return require.resolve('@anthropic-ai/claude-code/cli.js');
  } catch {
    return null;
  }
}

const CLI_PATH = resolveClaudeCliPath();

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleRequest(request) {
  const { requestId, prompt, cwd, sessionId, maxTurns = 10, skills } = request;

  if (!prompt) {
    emit({ requestId, type: 'error', message: 'prompt is required' });
    return;
  }

  try {
    const options = {
      cwd: cwd || process.cwd(),
      maxTurns,
      permissionMode: 'acceptEdits',
      ...(sessionId ? { resume: sessionId } : {}),
      ...(skills ? { skills } : {}),
    };

    if (CLI_PATH) {
      options.pathToClaudeCodeExecutable = CLI_PATH;
    }

    for await (const msg of query({ prompt, options })) {
      if (msg.type === 'system' && msg.session_id) {
        emit({ requestId, type: 'session', sessionId: msg.session_id });
      }

      if (msg.type === 'assistant') {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              emit({ requestId, type: 'output', content: block.text });
            }
          }
        }
      }

      if (msg.type === 'result' && msg.is_error) {
        emit({ requestId, type: 'error', message: msg.result || 'Claude returned an error' });
        return;
      }
    }

    emit({ requestId, type: 'done', exitCode: 0 });

  } catch (err) {
    emit({ requestId, type: 'error', message: err.message });
  }
}

// Persistent mode: read requests line by line from stdin
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

// Signal ready
emit({ type: 'ready' });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    emit({ type: 'error', message: 'Invalid JSON request' });
    return;
  }

  // Handle each request asynchronously
  handleRequest(request).catch((err) => {
    emit({ requestId: request.requestId, type: 'error', message: err.message });
  });
});

rl.on('close', () => {
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  emit({ type: 'error', message: `Uncaught: ${err.message}` });
});
