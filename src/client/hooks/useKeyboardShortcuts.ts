import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const sectionRoutes = [
  '/',           // Ctrl+1: Requirements
  '/workspace',  // Ctrl+2: Workspace
  '/plan',       // Ctrl+3: Plan
  '/execution',  // Ctrl+4: Execution
  '/tests',      // Ctrl+5: Tests
  '/skills',     // Ctrl+6: Skills
  '/mcp',        // Ctrl+7: MCP
  '/pipelines',  // Ctrl+8: Pipelines
];

export interface KeyboardShortcutHandlers {
  onGeneratePlan?: () => void;
  onConfirmExecution?: () => void;
  onRunTests?: () => void;
}

/**
 * Hook that registers global keyboard shortcuts:
 * - Ctrl+1 through Ctrl+8: Navigate to each section
 * - Ctrl+G: Trigger plan generation
 * - Ctrl+Enter: Confirm execution
 * - Ctrl+T: Run tests
 */
export function useKeyboardShortcuts(handlers?: KeyboardShortcutHandlers) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only handle Ctrl key combinations (not inside input/textarea)
      if (!e.ctrlKey || e.altKey || e.metaKey) return;

      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+1 through Ctrl+8: Navigate to sections
      const numKey = parseInt(e.key, 10);
      if (numKey >= 1 && numKey <= 8) {
        e.preventDefault();
        navigate(sectionRoutes[numKey - 1]);
        return;
      }

      // Ctrl+G: Trigger plan generation
      if (e.key === 'g' || e.key === 'G') {
        if (isInput) return;
        e.preventDefault();
        handlers?.onGeneratePlan?.();
        return;
      }

      // Ctrl+Enter: Confirm execution
      if (e.key === 'Enter') {
        e.preventDefault();
        handlers?.onConfirmExecution?.();
        return;
      }

      // Ctrl+T: Run tests
      if (e.key === 't' || e.key === 'T') {
        if (isInput) return;
        e.preventDefault();
        handlers?.onRunTests?.();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, handlers]);
}
