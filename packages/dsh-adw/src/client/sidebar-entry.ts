/**
 * Sidebar entry injection (task-board pattern).
 *
 * The sidebar shell exposes no slot an external plugin can register into, so
 * the entry row is injected below the New Session button — after the family
 * block (task-board / ssh entries) so sibling plugins keep their positions.
 * The injection self-heals: a MutationObserver re-inserts the row whenever a
 * React re-render displaces it, in the same frame (no flicker).
 */

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-adw-entry]'

/** Inline icon (document/list look, 16px nav-icon style). */
const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h6l2.5 2.5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M10 2.5V5h2.5M5.5 8.5h5M5.5 11h5"/></svg>`

/** Entry label (zh-first product copy, matching the family style). */
const LABEL = '需求工作台'

/** Find the sidebar shell root element, or undefined while not yet mounted. */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** Build the entry row (a detached button); active state synced via sync(). */
function createEntry(onToggle: () => void, isActive: () => boolean): { entry: HTMLButtonElement; sync: () => void } {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshAdwEntry = ''
  entry.className = 'adw-entry'
  entry.setAttribute('aria-label', LABEL)
  entry.innerHTML = `<span class="adw-entryIcon">${ICON}</span><span class="adw-entryLabel">${LABEL}</span>`
  const sync = (): void => {
    if (isActive()) entry.dataset.active = 'true'
    else delete entry.dataset.active
    entry.setAttribute('aria-pressed', isActive() ? 'true' : 'false')
  }
  entry.addEventListener('click', () => {
    onToggle()
    sync()
  })
  return { entry, sync }
}

/** Re-insert the entry after the family block (task-board/ssh entries stay first). */
function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
        && el.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-adw-entry]'),
    )
    // adw sits at the END of the family block (it must not displace siblings).
    const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
    root.insertBefore(entry, anchor)
  }
  return true
}

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param onToggle - toggle the requirement panel.
 * @param isActive - whether the panel is open (active highlight).
 * @param onStateChange - subscribe to panel state changes (keeps the entry's
 *   active highlight in sync no matter how the panel was closed — 返回聊天,
 *   sibling-panel activation, sidebar-row clicks).
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(onToggle: () => void, isActive: () => boolean, onStateChange?: (fn: () => void) => () => void): () => void {
  if (typeof document !== 'undefined' && document.querySelector(ENTRY_SELECTOR) !== null) {
    return () => {}
  }
  const { entry, sync } = createEntry(onToggle, isActive)
  const unsubscribeState = onStateChange?.(sync) ?? ((): (() => void) => ((): void => {}))()
  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) {
      rootObserver.observe(root, { childList: true, subtree: true })
    }
  }

  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry)
    }
  })

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribeState()
    entry.remove()
  }
}
