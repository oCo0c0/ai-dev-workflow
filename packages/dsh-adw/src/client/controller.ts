/**
 * Panel controller: the open/close observable both the sidebar entry and the
 * center-column mount subscribe to. Deliberately tiny — the panel's data
 * state lives in React; only visibility crosses the React/DOM boundary.
 *
 * Also holds the optional settings scope for the 'dsh-adw' namespace: the
 * panel's「源」view and the settings card share one MinerU config row, and
 * the scope (present whenever a settings surface serves the client) is what
 * makes the row writable from either surface.
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** Visibility + settings-scope controller shared by the plugin surfaces. */
export interface PanelController {
  toggle(): void
  open(): void
  close(): void
  isOpen(): boolean
  subscribe(fn: () => void): () => void
  /** Store the settings scope for the 'dsh-adw' namespace (settings surface present). */
  noteSettingsScope(scope: SettingsScope<Record<string, unknown>> | undefined): void
  /** The settings scope for the 'dsh-adw' namespace, when a settings surface serves this client. */
  getSettingsScope(): SettingsScope<Record<string, unknown>> | undefined
}

/** Create a controller with closure state. */
export function createPanelController(): PanelController {
  let open = false
  let scope: SettingsScope<Record<string, unknown>> | undefined
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const fn of listeners) fn() }
  return {
    toggle() { open = !open; emit() },
    open() { if (!open) { open = true; emit() } },
    close() { if (open) { open = false; emit() } },
    isOpen: () => open,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    noteSettingsScope(next) {
      scope = next
      emit()
    },
    getSettingsScope: () => scope,
  }
}
