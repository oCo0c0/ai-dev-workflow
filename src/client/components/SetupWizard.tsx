import { useState, useEffect } from 'react';
import { apiGet } from '../api';

interface SystemStatus {
  claudeCodeAvailable: boolean;
  claudeCodeVersion?: string;
  mcpServers: { name: string; status: string }[];
  configPath: string;
  uptime: number;
}

type SetupStep = 'checking-cli' | 'checking-mcp' | 'complete' | 'error';

const SETUP_FLAG = 'ai-workbench-setup-complete';

export default function SetupWizard() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<SetupStep>('checking-cli');
  const [cliAvailable, setCliAvailable] = useState(false);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const setupComplete = localStorage.getItem(SETUP_FLAG);
    if (!setupComplete) {
      setVisible(true);
      checkSystem();
    }
  }, []);

  async function checkSystem() {
    setStep('checking-cli');
    setError(null);

    try {
      const status = await apiGet<SystemStatus>('/system/status');
      setCliAvailable(status.claudeCodeAvailable);

      setStep('checking-mcp');
      const hasConnectedMcp = status.mcpServers.some((s) => s.status === 'connected');
      setMcpConnected(hasConnectedMcp);

      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check system status');
      setStep('error');
    }
  }

  function handleComplete() {
    localStorage.setItem(SETUP_FLAG, 'true');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-800 p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-semibold text-gray-100">
          Welcome to AI Dev Workbench
        </h2>
        <p className="mb-6 text-sm text-gray-400">
          Let's verify your environment is ready.
        </p>

        {/* Step 1: Claude Code CLI */}
        <div className="mb-4 flex items-center gap-3">
          <StatusIcon
            status={
              step === 'checking-cli'
                ? 'loading'
                : cliAvailable
                ? 'success'
                : 'warning'
            }
          />
          <div>
            <p className="text-sm font-medium text-gray-200">Claude Code CLI</p>
            <p className="text-xs text-gray-400">
              {step === 'checking-cli'
                ? 'Checking availability...'
                : cliAvailable
                ? 'Available and ready'
                : 'Not found — install Claude Code CLI to enable AI features'}
            </p>
          </div>
        </div>

        {/* Step 2: ONES MCP Connection */}
        <div className="mb-4 flex items-center gap-3">
          <StatusIcon
            status={
              step === 'checking-cli'
                ? 'pending'
                : step === 'checking-mcp'
                ? 'loading'
                : mcpConnected
                ? 'success'
                : 'warning'
            }
          />
          <div>
            <p className="text-sm font-medium text-gray-200">MCP Connection</p>
            <p className="text-xs text-gray-400">
              {step === 'checking-cli' || step === 'checking-mcp'
                ? 'Checking MCP server status...'
                : mcpConnected
                ? 'Connected to MCP server'
                : 'No MCP server connected — configure in MCP panel'}
            </p>
          </div>
        </div>

        {/* Error state */}
        {step === 'error' && error && (
          <div className="mb-4 rounded border border-red-700 bg-red-900/30 p-3">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={checkSystem}
              className="mt-2 text-xs text-red-200 underline hover:text-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {/* Summary */}
        {step === 'complete' && (
          <div className="mb-4 rounded border border-gray-600 bg-gray-700/50 p-3">
            <p className="text-sm text-gray-300">
              {cliAvailable && mcpConnected
                ? '✅ Everything looks good! You are ready to start.'
                : !cliAvailable && !mcpConnected
                ? '⚠️ Claude Code CLI and MCP are not configured. Some features will be limited.'
                : !cliAvailable
                ? '⚠️ Claude Code CLI not found. AI coding features will be unavailable.'
                : '⚠️ No MCP server connected. Requirements fetching will be unavailable.'}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          {step === 'complete' && (
            <button
              onClick={handleComplete}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Complete Setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: 'pending' | 'loading' | 'success' | 'warning' }) {
  switch (status) {
    case 'pending':
      return <span className="flex h-5 w-5 items-center justify-center text-gray-500">○</span>;
    case 'loading':
      return (
        <span className="flex h-5 w-5 items-center justify-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
        </span>
      );
    case 'success':
      return <span className="flex h-5 w-5 items-center justify-center text-green-400">✓</span>;
    case 'warning':
      return <span className="flex h-5 w-5 items-center justify-center text-yellow-400">⚠</span>;
  }
}
