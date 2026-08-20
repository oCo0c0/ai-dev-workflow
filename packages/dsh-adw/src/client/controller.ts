/**
 * Panel controller: the open/close observable both the sidebar entry and the
 * center-column mount subscribe to. Deliberately tiny — the panel's data
 * state lives in React; only visibility crosses the React/DOM boundary.
 * (All plugin configuration lives in the settings page's「需求源」tab.)
 */

/** Visibility controller shared by the sidebar entry and the panel mount. */
export interface PanelController {
  toggle(): void
  open(): void
  close(): void
  isOpen(): boolean
  subscribe(fn: () => void): () => void
}

/** Create a controller with closure state. */
export function createPanelController(): PanelController {
  let open = false
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
  }
}
