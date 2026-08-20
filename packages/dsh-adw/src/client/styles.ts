/**
 * Panel styles: one plain CSS string with adw- prefixed classes, injected as
 * a single <style> tag (deduped). No CSS-modules build magic — every class is
 * global-by-construction but namespaced.
 *
 * Colors ride the dsh design tokens verbatim as the first-party plugins
 * (task-board / dsh-ssh) do — no hardcoded theme guesses, so the panel
 * follows whatever theme/skin the host GUI runs (light or dark).
 */

/** Injected once per page; the data attribute is the dedup key. */
const STYLE_TAG = 'data-dsh-adw-styles'

/** All panel CSS. */
export const CSS = `
/* ── 中列挂载与显隐（面板激活时隐藏聊天列的其它子节点） ─────────────── */
[data-pane="conversation"], [class*="centerCol"] { position: relative; }
[data-dsh-adw-view] {
  z-index: 60;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  display: none;
  position: absolute;
  inset: 0;
  flex-direction: column;
  font-size: 13px;
  font-family: var(--dsw-font-family, inherit);
}
html[data-dsh-adw-active] [data-dsh-adw-view] { display: flex; }
html[data-dsh-adw-active] [data-pane="conversation"] > :not([data-dsh-adw-view]),
html[data-dsh-adw-active] [class*="centerCol"] > :not([data-dsh-adw-view]) { display: none !important; }

/* ── 侧边栏入口 ─────────────────────────────────────────────── */
.adw-entry {
  width: 100%; height: 32px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; white-space: nowrap; background: transparent; border: none;
  border-radius: 8px; align-items: center; gap: 8px; padding: 0 12px;
  font-size: 13px; display: flex; font-family: inherit;
}
.adw-entry:hover { background: var(--dsw-specific-sidebar-nav-item-hover); color: var(--dsw-alias-label-primary); }
.adw-entry[data-active] { background: var(--dsw-specific-sidebar-nav-item-active); color: var(--dsw-alias-label-primary); font-weight: 600; }
.adw-entryIcon { flex: none; justify-content: center; align-items: center; display: inline-flex; }
.adw-entryLabel { text-overflow: ellipsis; overflow: hidden; }
[data-dsh-frame][data-sidebar-collapsed] .adw-entry { justify-content: center; width: 100%; padding: 0; }

/* ── 面板骨架 ───────────────────────────────────────────────── */
.adw-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.adw-header {
  flex: none; display: flex; flex-direction: column; gap: 8px;
  padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.adw-headerRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.adw-headerSpacer { flex: 1; }
.adw-title { font-size: 14px; font-weight: 600; margin-right: 4px; color: var(--dsw-alias-label-primary); }
.adw-back {
  border: none; background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer; font-size: 13px; padding: 4px 8px; border-radius: 6px; font-family: inherit;
}
.adw-back:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }

.adw-input, .adw-select, .adw-textarea {
  background: var(--dsw-specific-input-major); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 6px 10px; font-size: 13px; font-family: inherit; outline: none; min-width: 0;
  /* 宿主皮肤可能对 input 有全局居中——显式左对齐 */
  text-align: start;
}
.adw-input::placeholder, .adw-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
.adw-input:focus, .adw-select:focus, .adw-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
/* 检索行输入框：伸展但封顶，不做整行长条 */
.adw-input { flex: 1 1 200px; max-width: 420px; }
.adw-headerRow .adw-select { flex: 0 0 auto; }
.adw-textarea { width: 100%; resize: vertical; min-height: 160px; line-height: 1.55; }

.adw-btn {
  border: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer;
  font-family: inherit; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.adw-btn:hover:not(:disabled) { filter: brightness(1.08); }
.adw-btn:disabled { opacity: .5; cursor: not-allowed; }
.adw-btnPrimary {
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-info-fill); font-weight: 600;
}
.adw-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover); filter: none; }
.adw-btnDanger { color: var(--dsw-alias-state-error-primary); }
/* 顶栏「源」按钮激活态（源页打开时） */
.adw-btnActive { background: var(--dsw-alias-sidebar-nav-item-active); }
.adw-btnDanger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); filter: none; }
.adw-btnSm { padding: 3px 10px; font-size: 12px; border-radius: 6px; }

/* ── 列表 / 卡片 ───────────────────────────────────────────── */
.adw-body { flex: 1 1 auto; overflow-y: auto; padding: 14px; min-height: 0; }
.adw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.adw-card {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  padding: 12px 14px; cursor: pointer; background: var(--dsw-alias-bg-layer-2);
  display: flex; flex-direction: column; gap: 6px; text-align: left; font-family: inherit; color: inherit;
}
.adw-card:hover { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-bg-layer-3); }
.adw-cardTop { display: flex; align-items: center; gap: 8px; }
.adw-cardNumber { font-size: 12px; color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-markdown-code-block-small, ui-monospace, monospace); }
.adw-cardTitle { font-weight: 600; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.adw-cardMeta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.adw-badge {
  display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px;
  font-size: 11.5px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary);
}
.adw-badge[data-tone="succeeded"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.adw-badge[data-tone="failed"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.adw-badge[data-tone="running"] { color: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }
.adw-badge[data-tone="cancelled"] { color: var(--dsw-alias-label-dimmed); border-color: var(--dsw-alias-border-l2); }
.adw-badge[data-tone="accent"] { color: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }

.adw-empty { color: var(--dsw-alias-label-tertiary); padding: 40px 0; text-align: center; }
.adw-errorText { color: var(--dsw-alias-state-error-primary); font-size: 12.5px; word-break: break-all; }
.adw-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* ── 详情 ─────────────────────────────────────────────────── */
.adw-detail { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.adw-detailHead { display: flex; flex-direction: column; gap: 8px; }
.adw-detailTitle { font-size: 16px; font-weight: 700; }
.adw-section { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; overflow: hidden; }
.adw-sectionTitle {
  padding: 8px 12px; font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.adw-sectionBody { padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.adw-desc { white-space: pre-wrap; word-break: break-word; line-height: 1.6; font-size: 13px; max-height: 420px; overflow-y: auto; }
.adw-desc img { display: block; max-width: 100%; margin: 8px 0; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); }
.adw-check { display: flex; gap: 8px; align-items: baseline; font-size: 13px; line-height: 1.5; }
.adw-checkDot { color: var(--dsw-alias-label-tertiary); flex: none; }
.adw-link { color: var(--dsw-alias-brand-primary); text-decoration: none; word-break: break-all; }
.adw-link:hover { text-decoration: underline; }
.adw-execRow {
  display: flex; gap: 10px; align-items: center; font-size: 12.5px; padding: 6px 0;
  border-bottom: 1px dashed var(--dsw-alias-separator-primary); flex-wrap: wrap;
}
.adw-execRow:last-child { border-bottom: none; }
.adw-detailActions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ── 弹窗（dsh-ssh 同款配色：遮罩 mask-1，弹窗体 bg-base + shadow-lv3） ── */
.adw-modalBackdrop {
  position: fixed; inset: 0; background: var(--dsw-alias-bg-mask-1); z-index: 120;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.adw-modal {
  width: min(760px, 92vw); max-height: 86vh; overflow-y: auto;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px; box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  padding: 18px 20px; display: flex; flex-direction: column; gap: 12px;
}
.adw-modalTitle { font-size: 15px; font-weight: 700; }
.adw-field { display: flex; flex-direction: column; gap: 5px; }
.adw-fieldRow { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.adw-fieldLabel { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.adw-modalActions { display: flex; gap: 8px; justify-content: flex-end; }

/* ── 需求源设置（官方设置页「需求源」tab 专用；面板无配置面） ── */
.adw-setTab {
  display: flex; flex-direction: column; gap: 12px;
  max-width: 760px; width: 100%; margin: 0 auto;
  color: var(--dsw-alias-label-primary); font-size: 13px; text-align: start;
}
.adw-customSection {
  display: flex; flex-direction: column; gap: 8px;
  border-top: 1px dashed var(--dsw-alias-separator-primary); padding-top: 12px; margin-top: 4px;
}
.adw-srcCmdPreview {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46%;
}
.adw-envArea { min-height: 34px; max-height: 120px; resize: vertical; font-family: var(--dsw-alias-font-mono, monospace); font-size: 12px; line-height: 1.4; }
.adw-srcList { display: flex; flex-direction: column; gap: 10px; }
.adw-srcRow {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
}
.adw-srcRowHead { display: flex; align-items: center; gap: 8px; min-height: 26px; flex-wrap: wrap; }
.adw-srcRowHead strong { font-size: 13px; }
.adw-srcSpacer { flex: 1; }
.adw-srcForm { display: flex; flex-direction: column; gap: 8px; border-top: 1px dashed var(--dsw-alias-separator-primary); padding-top: 8px; }
/* 紧凑对齐表单：左侧标签列 + 右侧定宽控件列（340px、30px 高），所有行共享同一基线 */
.adw-formGrid { display: grid; grid-template-columns: max-content minmax(0, 340px); gap: 8px 14px; align-items: start; }
.adw-formLabel { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); line-height: 30px; white-space: nowrap; }
.adw-formCtrl { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.adw-formCtrl .adw-input, .adw-formCtrl .adw-select { flex: none; width: 100%; height: 30px; box-sizing: border-box; padding: 4px 9px; }
.adw-formCtrl .adw-textarea { width: 100%; box-sizing: border-box; }
.adw-formActions { grid-column: 2; display: flex; gap: 8px; align-items: center; min-width: 0; flex-wrap: wrap; }

/* ── 首次运行引导 ─────────────────────────────────────────── */
.adw-firstRun { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center; }
.adw-firstRunTitle { font-size: 14px; font-weight: 600; }

/* ── 附件解析（详情页附件行内联） ─────────────────────────── */
.adw-attItem { display: flex; flex-direction: column; gap: 6px; }
.adw-attRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.adw-parseResult {
  border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); padding: 8px 10px;
  display: flex; flex-direction: column; gap: 4px;
}
.adw-parseHead { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.adw-parseResult .adw-desc { max-height: 260px; font-size: 12.5px; }
`

/**
 * Inject the stylesheet once; safe to call repeatedly.
 * @returns disposer removing the tag (only the injecting caller keeps it).
 */
export function ensureStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[${STYLE_TAG}]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_TAG, '')
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
