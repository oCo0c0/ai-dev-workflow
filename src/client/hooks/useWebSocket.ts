import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/app-store';

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

/**
 * Calculates exponential backoff delay.
 * delay = baseDelay * 2^attempt
 */
export function calculateBackoff(attempt: number, baseDelay: number = BASE_DELAY): number {
  return baseDelay * Math.pow(2, attempt);
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setWsConnected = useAppStore((s) => s.setWsConnected);
  const addExecutionLog = useAppStore((s) => s.addExecutionLog);
  const setExecutionStatus = useAppStore((s) => s.setExecutionStatus);
  const setExecutionId = useAppStore((s) => s.setExecutionId);
  const setTestResults = useAppStore((s) => s.setTestResults);
  const setTestRunning = useAppStore((s) => s.setTestRunning);
  const setPlanStatus = useAppStore((s) => s.setPlanStatus);
  const addPlanLog = useAppStore((s) => s.addPlanLog);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'plan:progress':
            setPlanStatus('generating');
            if (message.data?.content) {
              addPlanLog(message.data.content);
            }
            break;

          case 'plan:complete':
            setPlanStatus(message.data?.status === 'ready' ? 'ready' : 'idle');
            break;

          case 'execution:output':
            addExecutionLog({
              timestamp: new Date().toISOString(),
              stepIndex: message.data.stepIndex ?? 0,
              type: 'output',
              content: message.data.content,
            });
            // Update execution status with current step
            if (message.data.executionId) {
              setExecutionId(message.data.executionId);
            }
            break;

          case 'execution:step_complete':
            addExecutionLog({
              timestamp: new Date().toISOString(),
              stepIndex: message.data.stepIndex ?? 0,
              type: message.data.status === 'success' ? 'info' : 'error',
              content: `Step ${message.data.stepIndex} ${message.data.status}`,
            });
            break;

          case 'execution:complete':
            setExecutionStatus({
              executionId: message.data.executionId || '',
              planId: '',
              currentStep: message.data.stepsCompleted || 0,
              totalSteps: message.data.stepsCompleted || 0,
              status: message.data.status === 'completed' ? 'completed' : 'failed',
              startedAt: '',
              completedAt: new Date().toISOString(),
            });
            if (message.data.executionId) {
              setExecutionId(message.data.executionId);
            }
            break;

          case 'test:output':
            addExecutionLog({
              timestamp: new Date().toISOString(),
              stepIndex: 0,
              type: 'output',
              content: message.data.content,
            });
            break;

          case 'test:complete':
            setTestResults(message.data);
            setTestRunning(false);
            break;

          case 'error':
            addExecutionLog({
              timestamp: new Date().toISOString(),
              stepIndex: 0,
              type: 'error',
              content: message.data.message,
            });
            break;
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [addExecutionLog, addPlanLog, setExecutionId, setExecutionStatus, setPlanStatus, setTestResults, setTestRunning]
  );

  const connect = useCallback(() => {
    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      retriesRef.current = 0; // Reset retries on successful connection
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;

      // Attempt reconnection with exponential backoff
      if (retriesRef.current < MAX_RETRIES) {
        const delay = calculateBackoff(retriesRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          retriesRef.current++;
          connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose will be called after onerror, so reconnection is handled there
      ws.close();
    };
  }, [handleMessage, setWsConnected]);

  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    connected: useAppStore((s) => s.ws.connected),
  };
}
