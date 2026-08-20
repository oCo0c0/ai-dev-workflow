window.__ModuleLoader__.load({
	id: "@along/dsh-adw",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/client/execution.ts
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function presetAlreadyRuns(error, mode) {
  if (typeof error !== "object" || error === null) return false;
  const details = error.details;
  if (typeof details !== "object" || details === null) return false;
  return details.existingPreset === mode;
}
function isErrorTurnEnd(data) {
  if (typeof data !== "object" || data === null) return false;
  const reason = data.reason;
  return typeof reason === "object" && reason !== null && reason.kind === "error";
}
var ExecutionService = class {
  constructor(env) {
    this.env = env;
  }
  /**
   * Run to completion (or a settled failure). Never rejects — every failure
   * path is reported as a settled event.
   */
  async run(request, onEvent, reporter) {
    let executionId;
    const settle = (outcome, error) => {
      onEvent({ kind: "settled", requirementId: request.requirementId, sessionId: "", outcome, error });
      if (executionId !== void 0) reporter?.settled(request.requirementId, executionId, outcome, error);
    };
    try {
      const sessionId = await this.connectSession(request.workspaceId);
      onEvent({ kind: "started", requirementId: request.requirementId, sessionId });
      const driver = this.env.sessions.binding(sessionId)?.session;
      if (driver === void 0) {
        settle("failed", "execution session is not ready");
        return;
      }
      if (!await this.applyMode(driver, request, sessionId, settle)) return;
      if (!await this.applyPermission(driver, request, settle)) return;
      await driver.rename(request.title).catch(() => {
      });
      try {
        executionId = (await reporter?.started(request.requirementId, sessionId))?.executionId;
      } catch {
      }
      const baseline = driver.getSnapshot().turnEnds.size;
      const accepted = await this.prompt(driver, request.prompt);
      if (!accepted.ok) {
        settle("failed", messageOf(accepted.error));
        return;
      }
      this.watchForSettlement(driver, sessionId, request.requirementId, executionId, reporter, onEvent, baseline);
    } catch (error) {
      settle("failed", messageOf(error));
    }
  }
  /** Recompose the blank session's agent from the pinned preset. */
  async applyMode(driver, request, sessionId, settle) {
    const mode = request.mode;
    if (mode === void 0 || mode === "") return true;
    const summary = this.env.sessions.list.getSnapshot().byId[sessionId];
    if (summary?.blank === false) {
      settle("failed", `cannot switch agent preset to ${mode}: the execution session is not blank`);
      return false;
    }
    if (summary?.agentPreset === mode) return true;
    const presets = this.env.presets;
    if (presets === void 0) {
      settle("failed", `this deployment does not support agent presets (task asks for ${mode})`);
      return false;
    }
    try {
      const result = await presets.select(sessionId, mode);
      if (!result.ok) {
        if (presetAlreadyRuns(result.error, mode)) {
          this.env.sessions.noteAgentPreset?.(sessionId, mode);
          return true;
        }
        settle("failed", `agent preset switch to ${mode} rejected: ${messageOf(result.error)}`);
        return false;
      }
    } catch (error) {
      settle("failed", `agent preset switch to ${mode} failed: ${messageOf(error)}`);
      return false;
    }
    this.env.sessions.noteAgentPreset?.(sessionId, mode);
    return true;
  }
  /** Apply the pinned permission preset through `/permission <id>`. */
  async applyPermission(driver, request, settle) {
    const permission = request.permission;
    if (permission === void 0 || permission === "") return true;
    const line = `/permission ${permission}`;
    try {
      const result = await driver.command(line);
      if (!result.ok) {
        settle("failed", `permission command rejected: ${messageOf(result.error)}`);
        return false;
      }
      if (!result.matched) {
        settle("failed", `permission command not recognized: ${line}`);
        return false;
      }
    } catch (error) {
      settle("failed", `permission command failed: ${messageOf(error)}`);
      return false;
    }
    return true;
  }
  /**
   * Inspect a reloaded requirement whose last execution has no endedAt and
   * return a settled event when its session already finished.
   */
  async reconcile(requirementId, sessionId) {
    const list = this.env.sessions.list.getSnapshot();
    if (list.phase !== "ready") return void 0;
    const summary = list.byId[sessionId];
    if (summary === void 0) return { outcome: "cancelled", error: "execution session no longer exists" };
    if (summary.running) return void 0;
    const driver = this.env.sessions.binding(sessionId)?.session;
    if (driver !== void 0) {
      const snapshot = driver.getSnapshot();
      if (snapshot.turnEnds.size > 0) {
        return {
          outcome: snapshot.lastAgentError !== null ? "failed" : "succeeded",
          error: snapshot.lastAgentError ?? void 0
        };
      }
    }
    const failed = await this.historyShowsFailure(sessionId);
    if (failed) return { outcome: "failed", error: "agent turn failed" };
    return { outcome: "succeeded" };
  }
  /** Best-effort failure probe over the raw history tail. */
  async historyShowsFailure(sessionId) {
    const history = this.env.history;
    if (history === void 0) return false;
    try {
      const tail = await history.loadTail(sessionId);
      if (tail === void 0) return false;
      return tail.events.some((event) => event.type === "turn/end" && isErrorTurnEnd(event.data));
    } catch {
      return false;
    }
  }
  async connectSession(workspaceId) {
    const workspace = this.env.workspaces.list.getSnapshot();
    if (!workspace.items.some((item) => item.workspaceId === workspaceId)) {
      throw new Error(`workspace is not available: ${workspaceId}`);
    }
    return this.env.workspaces.connectWorkspace(workspaceId);
  }
  async prompt(driver, text) {
    try {
      return await driver.prompt([{ type: "text", text }], "queue");
    } catch (error) {
      return { ok: false, error };
    }
  }
  /** Subscribe and settle once the accepted turn completes. */
  watchForSettlement(driver, sessionId, requirementId, executionId, reporter, onEvent, baseline) {
    let settled = false;
    let unsubscribe = () => {
    };
    const check = () => {
      if (settled) return;
      const snapshot = driver.getSnapshot();
      if (snapshot.running || snapshot.turnEnds.size <= baseline) return;
      settled = true;
      unsubscribe();
      const outcome = snapshot.lastAgentError !== null ? "failed" : "succeeded";
      onEvent({
        kind: "settled",
        requirementId,
        sessionId,
        outcome,
        error: snapshot.lastAgentError ?? void 0
      });
      if (executionId !== void 0) reporter?.settled(requirementId, executionId, outcome, snapshot.lastAgentError ?? void 0);
    };
    unsubscribe = driver.subscribe(check);
    check();
  }
};

// src/client/controller.ts
function createPanelController() {
  let open = false;
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  return {
    toggle() {
      open = !open;
      emit();
    },
    open() {
      if (!open) {
        open = true;
        emit();
      }
    },
    close() {
      if (open) {
        open = false;
        emit();
      }
    },
    isOpen: () => open,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    }
  };
}

// src/client/sidebar-entry.ts
var ENTRY_SELECTOR = "[data-dsh-adw-entry]";
var ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h6l2.5 2.5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M10 2.5V5h2.5M5.5 8.5h5M5.5 11h5"/></svg>`;
var LABEL = "\u9700\u6C42\u5DE5\u4F5C\u53F0";
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return void 0;
  const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
  return logoOwner ?? column.firstElementChild;
}
function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]');
  if (nested !== null) return nested;
  for (const child of root.children) {
    if (child.tagName === "BUTTON") return child;
  }
  return void 0;
}
function createEntry(onToggle, isActive) {
  const entry = document.createElement("button");
  entry.type = "button";
  entry.dataset.dshAdwEntry = "";
  entry.className = "adw-entry";
  entry.setAttribute("aria-label", LABEL);
  entry.innerHTML = `<span class="adw-entryIcon">${ICON}</span><span class="adw-entryLabel">${LABEL}</span>`;
  const sync = () => {
    if (isActive()) entry.dataset.active = "true";
    else delete entry.dataset.active;
    entry.setAttribute("aria-pressed", isActive() ? "true" : "false");
  };
  entry.addEventListener("click", () => {
    onToggle();
    sync();
  });
  return { entry, sync };
}
function placeEntry(root, entry) {
  const button = newSessionButton(root);
  if (button === void 0) return false;
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]');
    const base = row !== null && row.parentElement === root ? row : button;
    const family = Array.from(root.children).filter(
      (el) => el instanceof HTMLElement && el.matches("[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-adw-entry]")
    );
    const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling;
    root.insertBefore(entry, anchor);
  }
  return true;
}
function mountSidebarEntry(onToggle, isActive, onStateChange) {
  if (typeof document !== "undefined" && document.querySelector(ENTRY_SELECTOR) !== null) {
    return () => {
    };
  }
  const { entry, sync } = createEntry(onToggle, isActive);
  const unsubscribeState = onStateChange?.(sync) ?? /* @__PURE__ */ (() => () => {
  })();
  let root;
  let placed = false;
  const tryPlace = () => {
    if (root !== void 0 && !root.isConnected) {
      rootObserver.disconnect();
      root = void 0;
      placed = false;
    }
    if (placed) {
      if (document.body.contains(entry)) return;
      rootObserver.disconnect();
      root = void 0;
      placed = false;
    }
    root ??= sidebarRoot();
    if (root === void 0) return;
    placed = placeEntry(root, entry);
    if (placed) {
      rootObserver.observe(root, { childList: true, subtree: true });
    }
  };
  const waitObserver = new MutationObserver(() => {
    tryPlace();
  });
  waitObserver.observe(document.body, { childList: true, subtree: true });
  const rootObserver = new MutationObserver(() => {
    if (root === void 0 || !root.isConnected) {
      placed = false;
      tryPlace();
      return;
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry);
    }
  });
  tryPlace();
  return () => {
    waitObserver.disconnect();
    rootObserver.disconnect();
    unsubscribeState();
    entry.remove();
  };
}

// src/client/panel-mount.tsx
var import_client = require("react-dom/client");

// src/client/Panel.tsx
var import_react = require("react");

// src/client/api.ts
var BASE = "/api/dsh-adw";
var AdwApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function call(path, init) {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers ?? {} }
  });
  let body;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = void 0;
  }
  if (!response.ok) {
    throw new AdwApiError(response.status, body?.message ?? `HTTP ${response.status}`);
  }
  return body;
}
function listSources() {
  return call("/sources");
}
function fetchRequirement(input, serverName) {
  return call("/fetch", { method: "POST", body: JSON.stringify({ input, serverName }) });
}
function searchRequirements(query, serverName) {
  const q = encodeURIComponent(query);
  const s = serverName ? `&server=${encodeURIComponent(serverName)}` : "";
  return call(`/search?q=${q}${s}`);
}
function listRequirements() {
  return call("/requirements");
}
function deleteRequirement(id) {
  return call(`/requirements/${encodeURIComponent(id)}`, { method: "DELETE" });
}
function refreshRequirement(id) {
  return call(`/requirements/${encodeURIComponent(id)}/refresh`, { method: "POST" });
}
function getDevPrompt(id) {
  return call(`/requirements/${encodeURIComponent(id)}/dev-prompt`);
}
function reportExecution(id, link) {
  return call(`/requirements/${encodeURIComponent(id)}/executions`, {
    method: "POST",
    body: JSON.stringify(link)
  });
}
function settleExecution(id, executionId, outcome, error) {
  return call(`/requirements/${encodeURIComponent(id)}/executions/${encodeURIComponent(executionId)}/settle`, {
    method: "POST",
    body: JSON.stringify({ outcome, error })
  });
}
function installSource(adapterId, env) {
  return call(`/sources/${encodeURIComponent(adapterId)}/install`, {
    method: "POST",
    body: JSON.stringify({ env })
  });
}
function testServer(name) {
  return call(`/servers/${encodeURIComponent(name)}/test`, { method: "POST" });
}
function removeServer(name) {
  return call(`/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
}
function listServers() {
  return call("/servers");
}
function addServer(config) {
  return call("/servers", { method: "POST", body: JSON.stringify(config) });
}
function mineruHealth() {
  return call("/mineru/health");
}
function parseDocument(input) {
  return call("/mineru/parse", { method: "POST", body: JSON.stringify({ input }) });
}

// src/client/Panel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function fmtTime(iso) {
  if (iso === void 0) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
function toneOf(outcome, running) {
  if (running) return "running";
  if (outcome === "succeeded") return "succeeded";
  if (outcome === "failed") return "failed";
  if (outcome === "cancelled") return "cancelled";
  return "";
}
var OUTCOME_LABEL = {
  succeeded: "\u5DF2\u5B8C\u6210",
  failed: "\u5DF2\u5931\u8D25",
  cancelled: "\u5DF2\u53D6\u6D88",
  running: "\u8FDB\u884C\u4E2D"
};
function AdwPanel(props) {
  const { controller, services } = props;
  const [sources, setSources] = (0, import_react.useState)([]);
  const [serverName, setServerName] = (0, import_react.useState)("");
  const [input, setInput] = (0, import_react.useState)("");
  const [view, setView] = (0, import_react.useState)({ kind: "list" });
  const [reqs, setReqs] = (0, import_react.useState)([]);
  const [busy, setBusy] = (0, import_react.useState)("");
  const [error, setError] = (0, import_react.useState)("");
  const [running, setRunning] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const reload = (0, import_react.useCallback)(async (withSources = false) => {
    try {
      if (withSources) setSources(await listSources());
      setReqs(await listRequirements());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  (0, import_react.useEffect)(() => {
    void (async () => {
      await reload(true);
      try {
        const list = await listRequirements();
        for (const req of list) {
          const last = req.executions[req.executions.length - 1];
          if (last === void 0 || last.endedAt !== void 0) continue;
          const verdict = await services.exec.reconcile(req.id, last.sessionId);
          if (verdict !== void 0) {
            await settleExecution(req.id, last.executionId, verdict.outcome, verdict.error);
          }
        }
        setReqs(await listRequirements());
      } catch {
      }
    })();
  }, []);
  const serverOptions = sources.flatMap((s) => s.servers.map((name) => ({ value: name, label: `${s.label} \xB7 ${name}` })));
  const runExecution = (0, import_react.useCallback)(async (req, target, prompt) => {
    const title = `[ADW] ${req.number ?? req.id} ${req.title}`.trim();
    setRunning((prev) => new Set(prev).add(req.id));
    setError("");
    const onEvent = (event) => {
      if (event.kind === "settled") {
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(req.id);
          return next;
        });
        void reload();
      }
    };
    await services.exec.run(
      {
        requirementId: req.id,
        title,
        prompt,
        workspaceId: target.workspaceId,
        mode: target.mode || void 0,
        permission: target.permission || void 0
      },
      onEvent,
      {
        started: async (requirementId, sessionId) => {
          try {
            return await reportExecution(requirementId, {
              sessionId,
              workspaceId: target.workspaceId,
              prompt,
              mode: target.mode || void 0,
              permission: target.permission || void 0
            });
          } catch {
            return void 0;
          }
        },
        settled: (requirementId, executionId, outcome, err) => {
          void settleExecution(requirementId, executionId, outcome, err).catch(() => void 0);
        }
      }
    );
  }, [reload, services]);
  const doFetch = (0, import_react.useCallback)(async (raw) => {
    const value = raw.trim();
    if (value === "") return;
    setBusy("\u6B63\u5728\u62C9\u53D6\u9700\u6C42\u2026");
    setError("");
    try {
      const saved = await fetchRequirement(value, serverName || void 0);
      await reload();
      setView({ kind: "detail", id: saved.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }, [reload, serverName]);
  const doSearch = (0, import_react.useCallback)(async () => {
    const value = input.trim();
    if (value === "") return;
    setBusy("\u6B63\u5728\u641C\u7D22\u2026");
    setError("");
    try {
      const results = await searchRequirements(value, serverName || void 0);
      setView({ kind: "search", query: value, results });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }, [input, serverName]);
  const detail = view.kind === "detail" ? reqs.find((r) => r.id === view.id) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "adw-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-headerRow", children: [
        view.kind !== "list" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-back", onClick: () => setView({ kind: "list" }), children: "\u2039 \u8FD4\u56DE" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-title", children: "\u9700\u6C42\u5DE5\u4F5C\u53F0" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-headerSpacer" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn adw-btnSm", disabled: busy !== "", onClick: () => void reload(true), title: "\u5237\u65B0\u5217\u8868", children: "\u27F3" }),
        controller.isOpen() && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-back", onClick: () => controller.close(), children: "\u8FD4\u56DE\u804A\u5929" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-headerRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: "adw-select", value: serverName, onChange: (e) => setServerName(e.target.value), title: "\u9700\u6C42\u6E90\uFF08MCP server\uFF09", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u81EA\u52A8\u89E3\u6790\u6E90" }),
          serverOptions.map((opt) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: opt.value, children: opt.label }, opt.value))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "adw-input",
            value: input,
            placeholder: "\u9700\u6C42\u53F7 / issue key / \u94FE\u63A5\uFF0C\u5982 CWXT-130341",
            onChange: (e) => setInput(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") void doFetch(input);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn adw-btnPrimary", disabled: busy !== "" || input.trim() === "", onClick: () => void doFetch(input), children: "\u62C9\u53D6" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn", disabled: busy !== "" || input.trim() === "", onClick: () => void doSearch(), children: "\u641C\u7D22" })
      ] })
    ] }),
    busy !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-hint", style: { padding: "6px 14px" }, children: busy }),
    error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-errorText", style: { padding: "6px 14px" }, children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", { className: "adw-body", children: [
      view.kind === "list" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ListPage,
        {
          reqs,
          running,
          anyConfigured: serverOptions.length > 0,
          onOpen: (id) => setView({ kind: "detail", id })
        }
      ),
      view.kind === "search" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        SearchPage,
        {
          query: view.query,
          results: view.results,
          onFetch: (value) => void doFetch(value)
        }
      ),
      view.kind === "detail" && detail !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        DetailPage,
        {
          req: detail,
          running: running.has(detail.id),
          services,
          onRun: (target, prompt) => void runExecution(detail, target, prompt).then(() => reload()),
          onRefresh: async () => {
            setBusy("\u6B63\u5728\u91CD\u62C9\u2026");
            try {
              await refreshRequirement(detail.id);
              await reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy("");
            }
          },
          onDelete: async () => {
            await deleteRequirement(detail.id);
            await reload();
            setView({ kind: "list" });
          }
        }
      ),
      view.kind === "detail" && detail === void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-empty", children: "\u9700\u6C42\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664" })
    ] })
  ] });
}
function ListPage(props) {
  const { reqs, running, anyConfigured, onOpen } = props;
  if (reqs.length === 0 && !anyConfigured) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-firstRun", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-firstRunTitle", children: "\u4ECE\u914D\u7F6E\u4E00\u4E2A\u9700\u6C42\u6E90\u5F00\u59CB" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-hint", children: "\u6253\u5F00 \u8BBE\u7F6E \u2192 \u63D2\u4EF6 \u2192\u300C\u9700\u6C42\u6E90\u300D\u914D\u7F6E ONES / GitHub / \u81EA\u5B9A\u4E49 MCP\uFF1B" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-hint", children: "\u914D\u7F6E\u5B8C\u6210\u540E\u56DE\u5230\u8FD9\u91CC\uFF0C\u5728\u4E0A\u65B9\u8F93\u5165\u9700\u6C42\u53F7 / issue key / \u94FE\u63A5\u62C9\u53D6\u9700\u6C42\u3002" })
    ] });
  }
  if (reqs.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-empty", children: "\u8FD8\u6CA1\u6709\u9700\u6C42\u3002\u5728\u4E0A\u65B9\u8F93\u5165\u9700\u6C42\u53F7 / issue key / \u94FE\u63A5\u62C9\u53D6\u7B2C\u4E00\u4E2A\u9700\u6C42\u3002" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-grid", children: reqs.map((req) => {
    const last = req.executions[req.executions.length - 1];
    const isRunning = running.has(req.id) || last !== void 0 && last.endedAt === void 0;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "adw-card", onClick: () => onOpen(req.id), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-cardTop", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-cardNumber", children: req.number ?? req.id }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", "data-tone": toneOf(last?.outcome, isRunning), children: isRunning ? OUTCOME_LABEL.running : last !== void 0 ? OUTCOME_LABEL[last.outcome ?? ""] ?? "\u672A\u6267\u884C" : "\u672A\u6267\u884C" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-cardTitle", children: req.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-cardMeta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: req.source.adapterId }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: req.status }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          "\u6267\u884C ",
          req.executions.length,
          " \u6B21"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\xB7" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: fmtTime(req.source.fetchedAt) })
      ] })
    ] }, req.id);
  }) }) });
}
function SearchPage(props) {
  const { results, onFetch } = props;
  if (results.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-empty", children: "\u6CA1\u6709\u5339\u914D\u7684\u9700\u6C42" });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "adw-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-sectionTitle", children: [
      "\u641C\u7D22\u7ED3\u679C\uFF08",
      results.length,
      "\uFF09\u2014 \u70B9\u51FB\u62C9\u53D6\u5E76\u4FDD\u5B58"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionBody", children: results.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "adw-execRow", style: { cursor: "pointer", border: "none", background: "transparent", color: "inherit", textAlign: "left", font: "inherit" }, onClick: () => onFetch(String(r.number ?? r.id).replace("#", "")), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-cardNumber", children: r.number ?? r.id }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: r.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", children: r.status }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-hint", children: fmtTime(r.updatedAt) })
    ] }, r.id)) })
  ] });
}
function DetailPage(props) {
  const { req, running, services, onRun, onRefresh, onDelete } = props;
  const [dialogOpen, setDialogOpen] = (0, import_react.useState)(false);
  const [confirmDelete, setConfirmDelete] = (0, import_react.useState)(false);
  const [parsed, setParsed] = (0, import_react.useState)({});
  const last = req.executions[req.executions.length - 1];
  const isRunning = running || last !== void 0 && last.endedAt === void 0;
  const parseInputFor = (url) => {
    const m = url.match(/^\/api\/dsh-adw\/requirements\/([^/]+)\/images\/(.+)$/);
    return m !== null ? `adw-image://${m[1]}/${m[2]}` : url;
  };
  const doParse = (attachment) => {
    const key = attachment.url;
    setParsed((prev) => ({ ...prev, [key]: { status: "loading" } }));
    void parseDocument(parseInputFor(key)).then((result) => {
      setParsed((prev) => ({
        ...prev,
        [key]: result.success ? { status: "done", markdown: result.markdown } : { status: "error", error: result.error }
      }));
    }).catch((err) => {
      setParsed((prev) => ({ ...prev, [key]: { status: "error", error: err instanceof Error ? err.message : String(err) } }));
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-detail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-detailHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-cardNumber", children: req.number ?? req.id }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", "data-tone": toneOf(last?.outcome, isRunning), children: isRunning ? OUTCOME_LABEL.running : last !== void 0 ? OUTCOME_LABEL[last.outcome ?? ""] ?? "\u672A\u6267\u884C" : "\u672A\u6267\u884C" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-badge", children: [
          req.source.adapterId,
          " \xB7 ",
          req.source.serverName
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-hint", children: [
          "\u62C9\u53D6\u4E8E ",
          fmtTime(req.source.fetchedAt)
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-detailTitle", children: req.title }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-cardMeta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-badge", children: [
          "\u72B6\u6001 ",
          req.status
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-badge", children: [
          "\u4F18\u5148\u7EA7 ",
          req.priority
        ] }),
        req.assignee !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "adw-badge", children: [
          "\u8D1F\u8D23\u4EBA ",
          req.assignee
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-detailActions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn adw-btnPrimary", disabled: isRunning, onClick: () => setDialogOpen(true), children: "\u6267\u884C\u5F00\u53D1\u2026" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn", onClick: onRefresh, children: "\u91CD\u65B0\u62C9\u53D6" }),
        confirmDelete ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn adw-btnDanger", onClick: onDelete, children: "\u786E\u8BA4\u5220\u9664" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn", onClick: () => setConfirmDelete(false), children: "\u53D6\u6D88" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn adw-btnDanger", onClick: () => setConfirmDelete(true), children: "\u5220\u9664" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "adw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionTitle", children: "\u9700\u6C42\u63CF\u8FF0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionBody", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-desc", children: req.description !== "" ? renderRichText(req.description) : "\uFF08\u65E0\u63CF\u8FF0\uFF09" }) })
    ] }),
    req.acceptanceCriteria.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "adw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionTitle", children: "\u9A8C\u6536\u6807\u51C6" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionBody", children: req.acceptanceCriteria.map((c, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-check", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-checkDot", children: "\u2610" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: c })
      ] }, i)) })
    ] }),
    req.attachments.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "adw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionTitle", children: "\u9644\u4EF6" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionBody", children: req.attachments.map((a, i) => {
        const st = parsed[a.url];
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-attItem", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-attRow", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { className: "adw-link", href: a.url, target: "_blank", rel: "noreferrer", children: a.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                className: "adw-btn adw-btnSm",
                disabled: st?.status === "loading",
                title: "\u901A\u8FC7 MinerU \u89E3\u6790\u4E3A Markdown\uFF08\u9700\u5728 \u8BBE\u7F6E \u2192 \u63D2\u4EF6 \u2192 \u9700\u6C42\u6E90 \u4E2D\u914D\u7F6E MinerU \u670D\u52A1\uFF09",
                onClick: () => doParse(a),
                children: st?.status === "loading" ? "\u89E3\u6790\u4E2D\u2026" : st?.status === "done" ? "\u91CD\u65B0\u89E3\u6790" : "\u89E3\u6790"
              }
            )
          ] }),
          st?.status === "done" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-parseResult", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-parseHead", children: "\u9644\u4EF6\u89E3\u6790\u7ED3\u679C\uFF08MinerU\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-desc", children: (st.markdown ?? "").trim() !== "" ? renderRichText(st.markdown ?? "") : "\uFF08\u65E0\u6587\u672C\u5185\u5BB9\uFF09" })
          ] }),
          st?.status === "error" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-errorText", children: [
            "\u89E3\u6790\u5931\u8D25\uFF1A",
            st.error
          ] })
        ] }, i);
      }) })
    ] }),
    req.relatedIssues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "adw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionTitle", children: "\u5173\u8054\u95EE\u9898" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-sectionBody", children: req.relatedIssues.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-execRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-cardNumber", children: r.id }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: r.title }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", children: r.status })
      ] }, i)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "adw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-sectionTitle", children: [
        "\u6267\u884C\u5386\u53F2\uFF08",
        req.executions.length,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-sectionBody", children: [
        req.executions.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-hint", children: "\u5C1A\u672A\u6267\u884C\u8FC7\u5F00\u53D1" }),
        [...req.executions].reverse().map((e) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-execRow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", "data-tone": toneOf(e.outcome, e.endedAt === void 0), children: e.endedAt === void 0 ? OUTCOME_LABEL.running : OUTCOME_LABEL[e.outcome ?? ""] ?? e.outcome }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-hint", children: fmtTime(e.startedAt) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", children: e.mode !== void 0 && e.mode !== "" ? `\u6A21\u5F0F ${e.mode}` : "\u9ED8\u8BA4\u6A21\u5F0F" }),
          e.permission !== void 0 && e.permission !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-badge", children: e.permission }),
          e.error !== void 0 && e.error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-errorText", children: e.error }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-back", onClick: () => services.openSession(e.sessionId), children: "\u67E5\u770B\u4F1A\u8BDD" })
        ] }, e.executionId))
      ] })
    ] }),
    dialogOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ExecuteDialog,
      {
        req,
        services,
        onClose: () => setDialogOpen(false),
        onRun: (target, prompt) => {
          setDialogOpen(false);
          onRun(target, prompt);
        }
      }
    )
  ] });
}
function ExecuteDialog(props) {
  const { req, services, onClose, onRun } = props;
  const [prompt, setPrompt] = (0, import_react.useState)("");
  const [workspaceId, setWorkspaceId] = (0, import_react.useState)("");
  const [mode, setMode] = (0, import_react.useState)("");
  const [permission, setPermission] = (0, import_react.useState)("");
  const [workspaces, setWorkspaces] = (0, import_react.useState)([]);
  const [presets, setPresets] = (0, import_react.useState)([]);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [error, setError] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    void (async () => {
      try {
        const [promptResult] = await Promise.all([getDevPrompt(req.id)]);
        setPrompt(promptResult.prompt);
        setWorkspaces(services.workspaces());
        try {
          setPresets(await services.presets());
        } catch {
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [req.id]);
  const runnable = !loading && error === "" && workspaceId !== "" && prompt.trim() !== "";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-modalBackdrop", onClick: (e) => {
    if (e.target === e.currentTarget) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-modal", onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-modalTitle", children: [
      "\u6267\u884C\u5F00\u53D1 \xB7 ",
      req.number ?? req.id,
      " ",
      req.title
    ] }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-hint", children: "\u6B63\u5728\u51C6\u5907\uFF08\u6E32\u67D3\u5F00\u53D1 Prompt / \u8BFB\u53D6\u5DE5\u4F5C\u533A\u5217\u8868\uFF09\u2026" }),
    error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-errorText", children: error }),
    !loading && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-fieldRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "adw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-fieldLabel", children: "\u5DE5\u4F5C\u533A *" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: "adw-select", value: workspaceId, onChange: (e) => setWorkspaceId(e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u9009\u62E9\u5DE5\u4F5C\u533A\u2026" }),
            workspaces.map((w) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: w.workspaceId, children: w.title }, w.workspaceId))
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "adw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-fieldLabel", children: "\u6A21\u5F0F\uFF08agent \u9884\u8BBE\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: "adw-select", value: mode, onChange: (e) => setMode(e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u8FD0\u884C\u65F6\u9ED8\u8BA4" }),
            presets.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: p.id, disabled: p.broken, children: [
              p.name,
              p.isDefault ? "\uFF08\u9ED8\u8BA4\uFF09" : "",
              p.broken ? "\uFF08\u4E0D\u53EF\u7528\uFF09" : ""
            ] }, p.id))
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "adw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-fieldLabel", children: "\u6743\u9650" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: "adw-select", value: permission, onChange: (e) => setPermission(e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u4F1A\u8BDD\u9ED8\u8BA4" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "read-only", children: "read-only" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "workspace-write", children: "workspace-write" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "danger-full-access", children: "danger-full-access" })
          ] })
        ] })
      ] }),
      workspaces.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "adw-hint", children: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u5DE5\u4F5C\u533A\uFF1B\u8BF7\u5148\u5728 DSH \u4E2D\u6253\u5F00\u4E00\u4E2A\u9879\u76EE\u76EE\u5F55\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "adw-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "adw-fieldLabel", children: "\u5F00\u53D1 Prompt\uFF08\u53EF\u76F4\u63A5\u7F16\u8F91\uFF1B\u6267\u884C\u4F1A\u8BDD\u4EE5\u6B64\u4E3A\u6307\u4EE4\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { className: "adw-textarea", value: prompt, onChange: (e) => setPrompt(e.target.value), spellCheck: false })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "adw-modalActions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "adw-btn", onClick: onClose, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "adw-btn adw-btnPrimary",
            disabled: !runnable,
            title: permission === "danger-full-access" ? "\u5B8C\u6574\u78C1\u76D8\u8BBF\u95EE\u6743\u9650\uFF0C\u8BF7\u786E\u8BA4" : void 0,
            onClick: () => {
              if (permission === "danger-full-access" && !window.confirm("danger-full-access \u5C06\u6388\u4E88\u5B8C\u6574\u78C1\u76D8\u8BBF\u95EE\u6743\u9650\uFF0C\u786E\u8BA4\u6267\u884C\uFF1F")) return;
              onRun({ workspaceId, mode, permission }, prompt);
            },
            children: "\u786E\u8BA4\u6267\u884C"
          }
        )
      ] })
    ] })
  ] }) });
}
function renderRichText(text) {
  const nodes = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let cursor = 0;
  let match;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: match[2], alt: match[1], loading: "lazy" }, key++));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// src/client/panel-mount.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
var ACTIVE_ATTR = "data-dsh-adw-active";
var OTHER_ACTIVE_ATTRS = ["data-dsh-taskboard-active", "data-dsh-ssh-active"];
var ACTIVATE_EVENT = "dsh-panel-activate";
var PANEL_NAME = "adw";
function conversationColumn() {
  return document.querySelector(CONVERSATION_COLUMN_SELECTOR) ?? void 0;
}
function mountPanel(controller, services) {
  let root;
  let container;
  const ensure = () => {
    if (container !== void 0) return;
    const column = conversationColumn();
    if (column === void 0) return;
    container = document.createElement("div");
    container.dataset.dshAdwView = "";
    column.appendChild(container);
    root = (0, import_client.createRoot)(container);
    root.render(/* @__PURE__ */ (0, import_jsx_runtime2.jsx)(AdwPanel, { controller, services }));
  };
  const waitObserver = new MutationObserver(() => {
    ensure();
  });
  waitObserver.observe(document.body, { childList: true, subtree: true });
  const applyActive = () => {
    if (controller.isOpen()) {
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr);
      document.documentElement.setAttribute(ACTIVE_ATTR, "");
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }));
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR);
    }
  };
  const onOtherActivate = (event) => {
    const detail = event.detail;
    if ((detail === "taskboard" || detail === "ssh") && controller.isOpen()) {
      controller.close();
    }
  };
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
  const onClickSidebarRow = (event) => {
    if (!controller.isOpen()) return;
    const target = event.target;
    if (target === null) return;
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close();
  };
  document.addEventListener("click", onClickSidebarRow, true);
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
  const unsubscribe = controller.subscribe(applyActive);
  applyActive();
  ensure();
  return () => {
    document.removeEventListener("click", onClickSidebarRow, true);
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
    waitObserver.disconnect();
    unsubscribe();
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    root?.unmount();
    root = void 0;
    container?.remove();
    container = void 0;
  };
}

// src/client/settings-tab.tsx
var import_react3 = require("react");

// src/client/source-config.tsx
var import_react2 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function SourceConfigBody(props) {
  const { sources, onChanged } = props;
  const [openId, setOpenId] = (0, import_react2.useState)("");
  const [env, setEnv] = (0, import_react2.useState)({});
  const [busy, setBusy] = (0, import_react2.useState)("");
  const [note, setNote] = (0, import_react2.useState)(void 0);
  const run = (0, import_react2.useCallback)((key, fn) => {
    void (async () => {
      setBusy(key);
      setNote(void 0);
      try {
        setNote({ key, text: await fn() });
        onChanged();
      } catch (err) {
        setNote({ key, text: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy("");
      }
    })();
  }, [onChanged]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcList", children: [
    sources.map((source) => {
      const configured = source.servers.length > 0;
      const expanded = openId === source.adapterId;
      const key = source.adapterId;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcRowHead", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: source.label }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-badge", "data-tone": configured ? "succeeded" : "", children: configured ? source.servers.join("\u3001") : "\u672A\u914D\u7F6E" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-srcSpacer" }),
          configured ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "adw-btn adw-btnSm",
                disabled: busy !== "",
                onClick: () => run(key, async () => {
                  const r = await testServer(source.servers[0]);
                  return r.ok ? "\u8FDE\u63A5\u6210\u529F" : `\u8FDE\u63A5\u5931\u8D25\uFF1A${r.message}`;
                }),
                children: "\u6D4B\u8BD5"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "adw-btn adw-btnSm adw-btnDanger",
                disabled: busy !== "",
                onClick: () => run(key, async () => {
                  await removeServer(source.servers[0]);
                  return "\u5DF2\u79FB\u9664\u914D\u7F6E";
                }),
                children: "\u79FB\u9664"
              }
            )
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "adw-btn adw-btnSm", onClick: () => {
            setOpenId(expanded ? "" : key);
            setEnv({});
            setNote(void 0);
          }, children: expanded ? "\u6536\u8D77" : "\u914D\u7F6E" })
        ] }),
        expanded && source.installTemplate !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-srcForm", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formGrid", children: [
          source.installTemplate.envSpecs.map((spec) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react2.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "adw-formLabel", children: [
              spec.label,
              spec.required ? " *" : ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formCtrl", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  className: "adw-input",
                  type: spec.secret ? "password" : "text",
                  value: env[spec.key] ?? "",
                  onChange: (e) => setEnv((prev) => ({ ...prev, [spec.key]: e.target.value }))
                }
              ),
              spec.hint !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-hint", children: spec.hint })
            ] })
          ] }, spec.key)),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formActions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "adw-btn adw-btnPrimary adw-btnSm",
                disabled: busy !== "",
                onClick: () => run(key, async () => {
                  const missing = source.installTemplate.envSpecs.filter((s) => s.required && (env[s.key] ?? "").trim() === "");
                  if (missing.length > 0) throw new Error(`\u7F3A\u5C11\u5FC5\u586B\u9879\uFF1A${missing.map((m) => m.label).join("\u3001")}`);
                  const r = await installSource(source.adapterId, env);
                  setOpenId("");
                  return r.connectionTest ? r.connectionTest.ok ? "\u5DF2\u914D\u7F6E\u5E76\u8FDE\u63A5\u6210\u529F" : `\u5DF2\u914D\u7F6E\uFF1B\u8FDE\u63A5\u6D4B\u8BD5\uFF1A${r.connectionTest.message}` : "\u5DF2\u914D\u7F6E";
                }),
                children: busy === key ? "\u914D\u7F6E\u4E2D\u2026" : "\u4FDD\u5B58\u5E76\u6D4B\u8BD5"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "adw-btn adw-btnSm", onClick: () => {
              setOpenId("");
              setEnv({});
            }, children: "\u53D6\u6D88" })
          ] })
        ] }) }),
        busy === key && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-hint", children: "\u5904\u7406\u4E2D\u2026" }),
        busy !== key && note !== void 0 && note.key === key && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-hint", children: note.text })
      ] }, key);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CustomServerSection, { busy, note, run, onChanged }),
    props.mineru !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MineruConfigRow, { scope: props.mineru.scope })
  ] });
}
var MINERU_BACKEND_OPTIONS = [
  { value: "pipeline", label: "\u7ECF\u5178\u7BA1\u7EBF\uFF08\u7EAF CPU\uFF0C\u517C\u5BB9\u6240\u6709\u90E8\u7F72\uFF09" },
  { value: "vlm-auto-engine", label: "VLM \u5F15\u64CE\uFF08\u9700 GPU\uFF09" },
  { value: "vlm-http-client", label: "VLM \u8FDC\u7A0B\u670D\u52A1" },
  { value: "hybrid-auto-engine", label: "\u6DF7\u5408\u5F15\u64CE\uFF08\u9700 GPU\uFF09" },
  { value: "hybrid-http-client", label: "\u6DF7\u5408\u8FDC\u7A0B\u670D\u52A1" }
];
var MINERU_LANG_OPTIONS = [
  { value: "ch", label: "\u7B80\u4F53\u4E2D\u6587" },
  { value: "en", label: "\u82F1\u8BED" },
  { value: "japan", label: "\u65E5\u8BED" },
  { value: "korean", label: "\u97E9\u8BED" },
  { value: "chinese_cht", label: "\u7E41\u4F53\u4E2D\u6587" },
  { value: "latin", label: "\u62C9\u4E01\u6587" },
  { value: "arabic", label: "\u963F\u62C9\u4F2F\u6587" },
  { value: "east_slavic", label: "\u4E1C\u65AF\u62C9\u592B\u6587" },
  { value: "cyrillic", label: "\u897F\u91CC\u5C14\u6587" },
  { value: "devanagari", label: "\u5929\u57CE\u6587" }
];
function MineruConfigRow(props) {
  const { scope } = props;
  const [url, setUrl] = (0, import_react2.useState)("");
  const [editable, setEditable] = (0, import_react2.useState)("");
  const [backend, setBackend] = (0, import_react2.useState)("pipeline");
  const [lang, setLang] = (0, import_react2.useState)("ch");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [note, setNote] = (0, import_react2.useState)("");
  (0, import_react2.useEffect)(() => {
    if (scope === void 0) {
      setUrl("");
      setEditable("");
      setBackend("pipeline");
      setLang("ch");
      return;
    }
    const sync = () => {
      const snapshot = scope.getSnapshot();
      const value = typeof snapshot.value?.mineruUrl === "string" ? snapshot.value.mineruUrl : "";
      setUrl(value);
      setEditable(value);
      const b = typeof snapshot.value?.mineruBackend === "string" && snapshot.value.mineruBackend !== "" ? snapshot.value.mineruBackend : "pipeline";
      setBackend(MINERU_BACKEND_OPTIONS.some((o) => o.value === b) ? b : "pipeline");
      const l = typeof snapshot.value?.mineruLang === "string" && snapshot.value.mineruLang !== "" ? snapshot.value.mineruLang.split(/[,，\s]+/)[0] : "ch";
      setLang(MINERU_LANG_OPTIONS.some((o) => o.value === l) ? l : "ch");
    };
    sync();
    return scope.subscribe(sync);
  }, [scope]);
  (0, import_react2.useEffect)(() => {
    if (scope !== void 0) return;
    void mineruHealth().then((health) => {
      setUrl(health.baseUrl ?? "");
      setEditable(health.baseUrl ?? "");
    }).catch(() => {
    });
  }, [scope]);
  const applyNow = (field, value) => {
    void (async () => {
      setNote("");
      try {
        if (scope === void 0) throw new Error("\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528\uFF1A\u8BF7\u5728\u8BBE\u7F6E\u9875\u300C\u63D2\u4EF6\u300D\u5206\u7EC4\u4E2D\u914D\u7F6E");
        await scope.set(field, value);
        setNote("\u5DF2\u4FDD\u5B58");
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
      }
    })();
  };
  const save = () => {
    void (async () => {
      setBusy(true);
      setNote("");
      try {
        if (scope === void 0) throw new Error("\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528\uFF1A\u8BF7\u5728\u8BBE\u7F6E\u9875\u300C\u63D2\u4EF6\u300D\u5206\u7EC4\u4E2D\u914D\u7F6E");
        await scope.set("mineruUrl", editable.trim());
        setNote("\u5DF2\u4FDD\u5B58");
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };
  const probe = () => {
    void (async () => {
      setBusy(true);
      setNote("");
      try {
        const health = await mineruHealth();
        setNote(health.configured ? health.healthy ? `\u5065\u5EB7\uFF1A${health.latency ?? "?"}ms` : `\u4E0D\u53EF\u8FBE\uFF1A${health.error ?? "unknown"}` : "\u672A\u914D\u7F6E\u670D\u52A1\u5730\u5740");
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-customSection", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcRowHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "MinerU \u6587\u6863\u89E3\u6790" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-hint", children: "PDF / Word / \u622A\u56FE \u2192 Markdown\uFF08adw_parse_document \u5DE5\u5177\u4E0E\u9644\u4EF6\u89E3\u6790\u7528\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-badge", children: url !== "" ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formGrid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u670D\u52A1\u5730\u5740" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "input",
        {
          className: "adw-input",
          value: editable,
          disabled: scope === void 0,
          onChange: (e) => setEditable(e.target.value),
          placeholder: "http://127.0.0.1:8000"
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u89E3\u6790\u540E\u7AEF" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "select",
        {
          className: "adw-select",
          value: backend,
          disabled: scope === void 0,
          onChange: (e) => {
            setBackend(e.target.value);
            applyNow("mineruBackend", e.target.value);
          },
          children: MINERU_BACKEND_OPTIONS.map((o) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: o.value, children: o.label }, o.value))
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u8BC6\u522B\u8BED\u8A00" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "select",
        {
          className: "adw-select",
          value: lang,
          disabled: scope === void 0,
          onChange: (e) => {
            setLang(e.target.value);
            applyNow("mineruLang", e.target.value);
          },
          children: MINERU_LANG_OPTIONS.map((o) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: o.value, children: o.label }, o.value))
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formActions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "adw-btn adw-btnPrimary adw-btnSm", disabled: busy || scope === void 0, onClick: save, children: busy ? "\u5904\u7406\u4E2D\u2026" : "\u4FDD\u5B58" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "adw-btn adw-btnSm", disabled: busy, onClick: probe, children: "\u5065\u5EB7\u68C0\u67E5" }),
        scope === void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "adw-hint", children: [
          "\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u6B64\u5904\u53EA\u8BFB\uFF08\u5F53\u524D\u503C\uFF1A",
          url === "" ? "\u672A\u914D\u7F6E" : url,
          "\uFF09"
        ] })
      ] })
    ] }),
    note !== "" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-hint", children: note })
  ] });
}
function CustomServerRow(props) {
  const { server, busy, run, onChanged } = props;
  const key = `srv:${server.name}`;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcRow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcRowHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: server.name }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-badge", children: server.url !== void 0 ? "http" : server.type }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-hint adw-srcCmdPreview", children: server.url ?? [server.command, ...server.args].join(" ") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-srcSpacer" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          className: "adw-btn adw-btnSm",
          disabled: busy !== "",
          onClick: () => run(key, async () => {
            const r = await testServer(server.name);
            return r.ok ? "\u8FDE\u63A5\u6210\u529F" : `\u8FDE\u63A5\u5931\u8D25\uFF1A${r.message}`;
          }),
          children: "\u6D4B\u8BD5"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          className: "adw-btn adw-btnSm adw-btnDanger",
          disabled: busy !== "",
          onClick: () => run(key, async () => {
            await removeServer(server.name);
            onChanged();
            return `\u5DF2\u79FB\u9664 ${server.name}`;
          }),
          children: "\u79FB\u9664"
        }
      )
    ] }),
    busy === key && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-hint", children: "\u5904\u7406\u4E2D\u2026" })
  ] });
}
function CustomServerSection(props) {
  const { busy, note, run, onChanged } = props;
  const [servers, setServers] = (0, import_react2.useState)([]);
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [mode, setMode] = (0, import_react2.useState)("stdio");
  const [name, setName] = (0, import_react2.useState)("");
  const [command, setCommand] = (0, import_react2.useState)("");
  const [args, setArgs] = (0, import_react2.useState)("");
  const [url, setUrl] = (0, import_react2.useState)("");
  const [env, setEnv] = (0, import_react2.useState)("");
  const reload = (0, import_react2.useCallback)(async () => {
    try {
      setServers(await listServers());
    } catch {
    }
  }, []);
  (0, import_react2.useEffect)(() => {
    void reload();
  }, [reload, onChanged]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-customSection", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-srcRowHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: "\u81EA\u5B9A\u4E49 MCP \u670D\u52A1\u5668" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-hint", children: "stdio\uFF08npx / python / docker \u2026\uFF09\u6216\u8FDC\u7A0B http(s)\uFF0C\u517C\u5BB9\u6807\u51C6 mcpServers \u914D\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-srcSpacer" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "adw-btn adw-btnSm", onClick: () => {
        setOpen(!open);
        setMode("stdio");
      }, children: open ? "\u6536\u8D77" : "\u6DFB\u52A0" })
    ] }),
    servers.map((server) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CustomServerRow, { server, busy, run, onChanged }, server.name)),
    open && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-srcForm", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formGrid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u540D\u79F0 *" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { className: "adw-input", value: name, onChange: (e) => setName(e.target.value), placeholder: "\u5982 my-mcp" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u7C7B\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { className: "adw-select", value: mode, onChange: (e) => setMode(e.target.value === "url" ? "url" : "stdio"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "stdio", children: "\u672C\u5730 stdio" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "url", children: "\u8FDC\u7A0B http(s)" })
      ] }) }),
      mode === "stdio" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u547D\u4EE4 *" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { className: "adw-input", value: command, onChange: (e) => setCommand(e.target.value), placeholder: "\u5982 npx \u6216 python" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "\u53C2\u6570" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { className: "adw-input", value: args, onChange: (e) => setArgs(e.target.value), placeholder: "\u7A7A\u683C\u5206\u9694\uFF0C\u5982 -y some-mcp-server" }) })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: "URL *" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { className: "adw-input", value: url, onChange: (e) => setUrl(e.target.value), placeholder: "https://example.com/mcp" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "adw-formLabel", children: mode === "url" ? "\u8BF7\u6C42\u5934" : "\u73AF\u5883\u53D8\u91CF" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-formCtrl", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { className: "adw-textarea adw-envArea", value: env, onChange: (e) => setEnv(e.target.value), placeholder: mode === "url" ? "KEY=VALUE \u6BCF\u884C\u4E00\u4E2A\uFF0C\u5982 Authorization=Bearer xxx" : "KEY=VALUE \u6BCF\u884C\u4E00\u4E2A\uFF0C\u5982 API_KEY=xxx" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "adw-formActions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "adw-btn adw-btnPrimary adw-btnSm",
            disabled: busy !== "",
            onClick: () => run("custom:add", async () => {
              if (name.trim() === "") throw new Error("\u540D\u79F0\u5FC5\u586B");
              const envMap = {};
              for (const line of env.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed === "") continue;
                const eq = trimmed.indexOf("=");
                if (eq <= 0) throw new Error(`\u73AF\u5883\u53D8\u91CF\u683C\u5F0F\u9519\u8BEF\uFF08\u5E94\u4E3A KEY=VALUE\uFF09\uFF1A${trimmed}`);
                envMap[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
              }
              await addServer({
                name: name.trim(),
                ...mode === "url" ? { url: url.trim() } : { command: command.trim(), args: args.trim() === "" ? [] : args.trim().split(/\s+/) },
                env: envMap
              });
              setOpen(false);
              setName("");
              setCommand("");
              setArgs("");
              setUrl("");
              setEnv("");
              await reload();
              onChanged();
              return `\u5DF2\u6DFB\u52A0 ${name.trim()}\uFF0C\u53EF\u70B9\u300C\u6D4B\u8BD5\u300D\u9A8C\u8BC1`;
            }),
            children: busy === "custom:add" ? "\u6DFB\u52A0\u4E2D\u2026" : "\u6DFB\u52A0"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "adw-btn adw-btnSm", onClick: () => {
          setOpen(false);
          setName("");
          setCommand("");
          setArgs("");
          setUrl("");
          setEnv("");
        }, children: "\u53D6\u6D88" })
      ] })
    ] }) }),
    busy === "custom:add" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-hint", children: "\u5904\u7406\u4E2D\u2026" }),
    busy !== "custom:add" && note !== void 0 && note.key.startsWith("srv:") && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "adw-hint", children: note.text })
  ] });
}

// src/client/settings-tab.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var ADW_SETTINGS_NS = "dsh-adw";
function AdwSettingsTab(props) {
  const { scope } = props;
  const [sources, setSources] = (0, import_react3.useState)([]);
  const [error, setError] = (0, import_react3.useState)("");
  const reload = (0, import_react3.useCallback)(async () => {
    try {
      setSources(await listSources());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  (0, import_react3.useEffect)(() => {
    void reload();
  }, [reload]);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "adw-setTab", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "adw-hint", children: "\u9700\u6C42\u6E90\uFF08ONES / GitHub / \u81EA\u5B9A\u4E49 MCP\uFF09\u51ED\u636E\u4FDD\u5B58\u5728\u63D2\u4EF6\u81EA\u7BA1\u6587\u4EF6 ~/.dsh/dsh-adw/mcp-servers.json\uFF0C\u4FEE\u6539\u5373\u65F6\u751F\u6548\uFF0C\u4E0D\u8BFB\u5199\u4EFB\u4F55\u5176\u5B83\u5DE5\u5177\u7684\u914D\u7F6E\uFF1BMinerU \u5730\u5740\u5B58\u4E8E\u672C\u8BBE\u7F6E\u3002\u914D\u7F6E\u5B8C\u6210\u540E\uFF0C\u5230\u4FA7\u8FB9\u680F\u300C\u9700\u6C42\u5DE5\u4F5C\u53F0\u300D\u62C9\u53D6\u9700\u6C42\u3002" }),
    error !== "" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "adw-errorText", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(SourceConfigBody, { sources, onChanged: reload, mineru: { scope } })
  ] });
}
function createAdwSettingsTab(scope) {
  return function AdwSettingsTabBound() {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(AdwSettingsTab, { scope });
  };
}

// src/client/styles.ts
var STYLE_TAG = "data-dsh-adw-styles";
var CSS = `
/* \u2500\u2500 \u4E2D\u5217\u6302\u8F7D\u4E0E\u663E\u9690\uFF08\u9762\u677F\u6FC0\u6D3B\u65F6\u9690\u85CF\u804A\u5929\u5217\u7684\u5176\u5B83\u5B50\u8282\u70B9\uFF09 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

/* \u2500\u2500 \u4FA7\u8FB9\u680F\u5165\u53E3 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

/* \u2500\u2500 \u9762\u677F\u9AA8\u67B6 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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
  /* \u5BBF\u4E3B\u76AE\u80A4\u53EF\u80FD\u5BF9 input \u6709\u5168\u5C40\u5C45\u4E2D\u2014\u2014\u663E\u5F0F\u5DE6\u5BF9\u9F50 */
  text-align: start;
}
.adw-input::placeholder, .adw-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
.adw-input:focus, .adw-select:focus, .adw-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
/* \u68C0\u7D22\u884C\u8F93\u5165\u6846\uFF1A\u4F38\u5C55\u4F46\u5C01\u9876\uFF0C\u4E0D\u505A\u6574\u884C\u957F\u6761 */
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
/* \u9876\u680F\u300C\u6E90\u300D\u6309\u94AE\u6FC0\u6D3B\u6001\uFF08\u6E90\u9875\u6253\u5F00\u65F6\uFF09 */
.adw-btnActive { background: var(--dsw-alias-sidebar-nav-item-active); }
.adw-btnDanger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); filter: none; }
.adw-btnSm { padding: 3px 10px; font-size: 12px; border-radius: 6px; }

/* \u2500\u2500 \u5217\u8868 / \u5361\u7247 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

/* \u2500\u2500 \u8BE6\u60C5 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

/* \u2500\u2500 \u5F39\u7A97\uFF08dsh-ssh \u540C\u6B3E\u914D\u8272\uFF1A\u906E\u7F69 mask-1\uFF0C\u5F39\u7A97\u4F53 bg-base + shadow-lv3\uFF09 \u2500\u2500 */
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

/* \u2500\u2500 \u9700\u6C42\u6E90\u8BBE\u7F6E\uFF08\u5B98\u65B9\u8BBE\u7F6E\u9875\u300C\u9700\u6C42\u6E90\u300Dtab \u4E13\u7528\uFF1B\u9762\u677F\u65E0\u914D\u7F6E\u9762\uFF09 \u2500\u2500 */
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
/* \u7D27\u51D1\u5BF9\u9F50\u8868\u5355\uFF1A\u5DE6\u4FA7\u6807\u7B7E\u5217 + \u53F3\u4FA7\u5B9A\u5BBD\u63A7\u4EF6\u5217\uFF08340px\u300130px \u9AD8\uFF09\uFF0C\u6240\u6709\u884C\u5171\u4EAB\u540C\u4E00\u57FA\u7EBF */
.adw-formGrid { display: grid; grid-template-columns: max-content minmax(0, 340px); gap: 8px 14px; align-items: start; }
.adw-formLabel { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); line-height: 30px; white-space: nowrap; }
.adw-formCtrl { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.adw-formCtrl .adw-input, .adw-formCtrl .adw-select { flex: none; width: 100%; height: 30px; box-sizing: border-box; padding: 4px 9px; }
.adw-formCtrl .adw-textarea { width: 100%; box-sizing: border-box; }
.adw-formActions { grid-column: 2; display: flex; gap: 8px; align-items: center; min-width: 0; flex-wrap: wrap; }

/* \u2500\u2500 \u9996\u6B21\u8FD0\u884C\u5F15\u5BFC \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.adw-firstRun { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center; }
.adw-firstRunTitle { font-size: 14px; font-weight: 600; }

/* \u2500\u2500 \u9644\u4EF6\u89E3\u6790\uFF08\u8BE6\u60C5\u9875\u9644\u4EF6\u884C\u5185\u8054\uFF09 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.adw-attItem { display: flex; flex-direction: column; gap: 6px; }
.adw-attRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.adw-parseResult {
  border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); padding: 8px 10px;
  display: flex; flex-direction: column; gap: 4px;
}
.adw-parseHead { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.adw-parseResult .adw-desc { max-height: 260px; font-size: 12.5px; }
`;
function ensureStyles() {
  if (typeof document === "undefined") return () => {
  };
  if (document.querySelector(`style[${STYLE_TAG}]`) !== null) return () => {
  };
  const tag = document.createElement("style");
  tag.setAttribute(STYLE_TAG, "");
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return () => {
    tag.remove();
  };
}

// src/client/index.ts
var claimed = false;
var inject = ["sessions", "workspaces", "connection"];
function apply(ctx) {
  if (claimed) return;
  claimed = true;
  ctx.effect(() => () => {
    claimed = false;
  }, "dsh-adw: apply claim");
  const controller = createPanelController();
  const disposers = [ensureStyles()];
  ctx.inject(["slots", "settingsScope"], (settingsCtx) => {
    const scope = settingsCtx.settingsScope.bind({ namespace: ADW_SETTINGS_NS });
    return settingsCtx.slots.inject("settings.plugins.tab", () => {
      const unregister = settingsCtx.slots.register({
        name: "settings.plugins.tab",
        id: "adw-sources",
        order: 20,
        label: () => "\u9700\u6C42\u6E90"
      }, createAdwSettingsTab(scope));
      return () => {
        unregister();
      };
    });
  });
  try {
    const sessions = ctx.sessions;
    const workspaces = ctx.workspaces;
    const connection = ctx.get("connection");
    const exec = new ExecutionService({
      sessions: {
        list: sessions.list,
        binding: (id) => {
          const binding = sessions.binding(id);
          if (binding === void 0) return void 0;
          const { session } = binding;
          return {
            session: {
              rename: (title) => session.rename(title),
              prompt: (content, mode) => session.prompt(content, mode).then((result) => result.ok ? { ok: true } : { ok: false, error: result.error }),
              command: (line) => session.command(line).then((result) => result.ok ? { ok: true, matched: result.value.matched } : { ok: false, error: result.error }),
              getSnapshot: () => session.getSnapshot(),
              subscribe: (fn) => session.subscribe(fn)
            }
          };
        },
        noteAgentPreset: (sessionId, agentPreset) => sessions.noteAgentPreset(sessionId, agentPreset)
      },
      workspaces: {
        list: workspaces.list,
        connectWorkspace: (id) => workspaces.connectWorkspace(id)
      },
      presets: {
        select: async (sessionId, agentPreset) => {
          try {
            const response = await connection.api.agentPresets.select({ sessionId, agentPreset });
            return response.result.ok ? { ok: true } : { ok: false, error: response.result.error };
          } catch (error) {
            return { ok: false, error };
          }
        }
      },
      history: {
        loadTail: async (sessionId) => {
          const response = await connection.api.sessions.history({
            sessionId,
            maxMessages: 20
          });
          return response.result.ok ? { events: response.result.value.events.map((entry) => entry.event) } : void 0;
        }
      }
    });
    disposers.push(mountSidebarEntry(
      () => controller.toggle(),
      () => controller.isOpen(),
      (fn) => controller.subscribe(fn)
    ));
    disposers.push(mountPanel(controller, {
      exec,
      workspaces: () => {
        const snapshot = workspaces.list.getSnapshot();
        return snapshot.items.map((item) => ({
          workspaceId: item.workspaceId,
          title: item.title !== "" ? item.title : item.path
        }));
      },
      presets: async () => {
        const response = await connection.api.agentPresets.list({});
        if (!response.result.ok) return [];
        return response.result.value.presets.map((preset) => ({
          id: preset.id,
          name: preset.name ?? preset.id,
          description: preset.description ?? "",
          broken: Boolean(preset.broken),
          isDefault: preset.isDefault
        }));
      },
      openSession: (id) => sessions.open(id)
    }));
  } catch (error) {
    console.error("[dsh-adw] mount failed:", error);
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose();
  }, "dsh-adw: surfaces");
}
//# sourceMappingURL=.client-body.js.map

		return module.exports;
	}
});
