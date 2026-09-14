# 统一聊天输入框（权限模式 / 附件 / 语音 / 模型选择）实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 4 个页面（AgentExecutionPage / ExecutionPage / PlanPage / ProjectsPage）的聊天输入框统一为一个 `ChatInputBox` 组件，内置：权限模式三档选择器、MinerU 文件上传解析（引用注入）、语音输入（OpenAI 兼容 ASR）、Enter 发送 / Ctrl+Enter 与 Shift+Enter 换行、模型精简选择器（顶栏保留完整配置入口），并整体美化 UI。

**Architecture:** 前端新建 `ChatInputBox`（吸收并替换 `ExpandableTextarea`，含放大弹窗 + 提示词优化），下方工具栏挂 ModelPicker / PermissionPicker / 附件 / 麦克风 / 页面动作插槽 / 发送按钮。后端新增：内存 AttachmentStore（解析文本暂存 + 一次性消费注入 prompt，聊天记录只落 stub）、`/api/chat-attachments/upload`、`/api/asr/transcribe`；权限模式存入 `config.cliProvider.permissionMode`，经 `cli-runner-service → provider → bridge` 贯通。聊天消息体不改（仍是纯文本 message），附件通过独立的 `attachmentIds` 参数旁路传递。

**Tech Stack:** React 18 + Zustand + Tailwind（shadcn 约定）+ react-i18next；Express + multer(memoryStorage) + 原生 FormData/Blob；vitest。

**已确认的决策（用户拍板）:**
1. 权限模式三档：`confirm 询问确认` / `acceptEdits 自动接受编辑` / `bypassPermissions 完全放行`。claude 三档全支持；pi 映射 confirm→`confirm`、其余→`auto-allow`；codex（及 custom）不支持 → 选择器置灰提示。
2. 语音：服务端 `/api/asr/transcribe` 转发到 OpenAI 兼容 `/audio/transcriptions`（baseUrl/model/apiKey 可配置）；前端 MediaRecorder 录音。
3. 附件：引用注入。服务端暂存 MinerU 解析文本，消息只显示文件徽标，发送时注入引擎 prompt，聊天记录不膨胀。
4. 模型选择：双入口。输入框放精简切换器（引擎+模型），顶栏「模型配置」「Provider 切换」按钮**原样保留**（完整配置弹窗不动）。
5. 生效范围：权限模式为全局配置（与模型配置同级持久化），对之后每轮消息生效。
6. 快捷键：Enter 发送，Ctrl/Cmd+Enter 与 Shift+Enter 均换行（textarea 默认行为），中文输入法 composition 期间 Enter 不发送。

---

## 关键现状索引（实现者必读）

| 事项 | 位置 |
|---|---|
| 三页共用输入组件 | `src/client/components/ExpandableTextarea.tsx`（放大弹窗 :172-198、优化逻辑 :67-97、悬浮按钮 :108-134） |
| 各页输入区 | AgentExecutionPage :1016-1088（start/reply 双状态）；ExecutionPage :795-903；PlanPage :1102-1146；ProjectsPage :340-356（裸 input） |
| 模型配置状态 | `src/client/stores/app-store.ts` :414-431（state）、:840-940（actions：setCliProvider/setModelConfig/fetchModelConfig/saveModelConfig/fetchAvailableModels） |
| 模型档位数据 | `GET /api/system/available-models`（`src/server/routes/system.ts:221`，返回 `{providers: {id: {tiers:[{value,label,model}], current}}}`）；pi 模型列表在 store `piMeta.availableModels`（按 modelProvider 过滤）；custom 引擎模型列表在 providerCatalog 条目 `meta.models` |
| 顶栏模型按钮（保留不动） | `src/client/components/Layout.tsx:316-348` |
| 引擎切换 API | `POST /api/system/cli-provider/select {providerId}`（system.ts:130）；前端参考 `ProviderSetupModal.tsx:78` |
| 权限现状 | bridge 硬编码 `permissionMode:'acceptEdits'`（`src/bridge/claude-bridge.mjs:365`），`permissionEnabled` 时注入 canUseTool（:375）；pi 用 `env.ADW_PERMISSION_MODE`（`src/server/services/cli-providers/pi-provider.ts:304-306`）；codex 空实现（codex-provider.ts:468） |
| 权限选项类型 | `src/server/services/cli-providers/types.ts:217-240`（CLIProviderOptions） |
| provider 选项装配 | `src/server/services/cli-runner-service.ts:308-375`（runBridge 读 config 注入 modelOptions） |
| agent-execution 链路 | 路由 `src/server/routes/agent-execution.ts`（create :97 / start :154 / reply :213）；协调器 `src/server/services/agent-coordinator.ts`（execute :173 从 logs 解析 userReplies，runSingleShot :484-496 拼 prompt，子任务循环 runBridge :398，主 runBridge :509） |
| 经典流程 reply | execution 路由 :648（prompt=enrichPrompt(message) :695）；plan 路由 :1044（prompt=enrichPrompt(message) :1072）；projects/tasks 路由 :198（`taskScheduler.sendReply(taskId, message)`） |
| MinerU 服务 | `src/server/services/mineru-service.ts`（`parseBuffer(fileName, buffer, mimetype, options)` 返回 `{success, markdown?}` :96-106）；参考上传路由 `src/server/routes/mineru.ts:26,53` |
| 路由注册 | `src/server/index.ts:261-280` |
| API 封装 | `src/client/api.ts`（apiPost 为 JSON；FormData 需新增 helper，参考 RequirementsPage :296-298 直接 fetch） |
| i18n | `src/client/locales/{zh,en}.json`，命名空间分组，camelCase key |
| 配置结构 | `src/server/services/config-service.ts` AppConfig :32-113、DEFAULT_CONFIG :117-140（mineru :140-143 可参考） |
| 测试约定 | 与源码同目录 `*.test.ts`（如 `src/cli/port-finder.test.ts`），`pnpm test` = `vitest --run` |

---

### Task 1: 后端 — AttachmentStore 与注入格式化（TDD）

**Files:**
- Create: `src/server/services/attachment-store.ts`
- Test: `src/server/services/attachment-store.test.ts`

**Step 1: 写失败测试**

```ts
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AttachmentStore, formatAttachmentsBlock} from './attachment-store.js';

describe('AttachmentStore', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('save 生成 id 并记录字符数', () => {
        const store = new AttachmentStore();
        const att = store.save('a.pdf', '# hello');
        expect(att.id).toBeTruthy();
        expect(att.fileName).toBe('a.pdf');
        expect(att.chars).toBe('# hello'.length);
        expect(store.get(att.id)?.markdown).toBe('# hello');
    });

    it('drain 一次性消费：取出后删除，未知 id 忽略', () => {
        const store = new AttachmentStore();
        const a = store.save('a.pdf', 'A');
        const b = store.save('b.pdf', 'B');
        const drained = store.drain([a.id, 'nope', b.id]);
        expect(drained.map(d => d.id)).toEqual([a.id, b.id]);
        expect(store.get(a.id)).toBeUndefined();
        expect(store.drain([a.id])).toEqual([]);
    });

    it('bindPending/takePending 按会话主体一次性取走', () => {
        const store = new AttachmentStore();
        const a = store.save('a.pdf', 'A');
        store.bindPending('exec-1', [a]);
        expect(store.takePending('exec-1').map(x => x.id)).toEqual([a.id]);
        expect(store.takePending('exec-1')).toEqual([]);
    });

    it('sweep 清理超过 TTL 的条目', () => {
        const store = new AttachmentStore();
        const a = store.save('a.pdf', 'A');
        vi.advanceTimersByTime(31 * 60 * 1000);
        store.sweep();
        expect(store.get(a.id)).toBeUndefined();
    });
});

describe('formatAttachmentsBlock', () => {
    it('空数组返回空串', () => {
        expect(formatAttachmentsBlock([])).toBe('');
    });
    it('生成 XML 风格附件块', () => {
        const md = formatAttachmentsBlock([
            {id: '1', fileName: '需求.pdf', markdown: '# 内容', chars: 4, createdAt: 0},
        ]);
        expect(md).toContain('<attachments>');
        expect(md).toContain('<attachment name="需求.pdf">');
        expect(md).toContain('# 内容');
        expect(md).toContain('</attachments>');
    });
});
```

**Step 2: 运行确认失败**

Run: `npx vitest --run src/server/services/attachment-store.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现**

```ts
/**
 * @file attachment-store.ts
 * @description 聊天附件的内存暂存：上传时经 MinerU 解析为 markdown 存入，
 *   发送消息时一次性取出并注入引擎 prompt——聊天记录只落 stub，不存全文。
 */

export interface StoredAttachment {
    id: string;
    fileName: string;
    markdown: string;
    chars: number;
    createdAt: number;
}

/** 内存暂存 TTL：30 分钟未消费即清理 */
const TTL_MS = 30 * 60 * 1000;

export class AttachmentStore {
    private entries = new Map<string, StoredAttachment>();
    private pendingByOwner = new Map<string, StoredAttachment[]>();

    save(fileName: string, markdown: string): StoredAttachment {
        this.sweep();
        const att: StoredAttachment = {
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName,
            markdown,
            chars: markdown.length,
            createdAt: Date.now(),
        };
        this.entries.set(att.id, att);
        return att;
    }

    get(id: string): StoredAttachment | undefined {
        return this.entries.get(id);
    }

    /** 一次性消费：按 id 取出并删除（未知 id 忽略） */
    drain(ids: string[]): StoredAttachment[] {
        const out: StoredAttachment[] = [];
        for (const id of ids) {
            const att = this.entries.get(id);
            if (att) {
                out.push(att);
                this.entries.delete(id);
            }
        }
        return out;
    }

    /** 绑定到会话主体（agent-execution 的 executionId），由协调器组 prompt 时取走 */
    bindPending(ownerId: string, atts: StoredAttachment[]): void {
        const list = this.pendingByOwner.get(ownerId) ?? [];
        list.push(...atts);
        this.pendingByOwner.set(ownerId, list);
    }

    takePending(ownerId: string): StoredAttachment[] {
        const list = this.pendingByOwner.get(ownerId) ?? [];
        this.pendingByOwner.delete(ownerId);
        return list;
    }

    sweep(): void {
        const now = Date.now();
        for (const [id, att] of this.entries) {
            if (now - att.createdAt > TTL_MS) this.entries.delete(id);
        }
    }
}

/** 把解析后的附件格式化为注入 prompt 的 XML 块 */
export function formatAttachmentsBlock(atts: StoredAttachment[]): string {
    if (atts.length === 0) return '';
    const body = atts
        .map(a => `<attachment name="${a.fileName}">\n${a.markdown}\n</attachment>`)
        .join('\n');
    return `\n\n<attachments>\n以下是用户随消息附带的文档（已经 MinerU 解析为 markdown），请结合其内容理解用户需求：\n${body}\n</attachments>`;
}
```

注意：`fileName` 含引号会破坏 XML 结构，save 时做一次净化：`fileName.replace(/"/g, "'")`（写入 Step 3 实现的 save 中），并在测试中补一条用例。

**Step 4: 运行确认通过**

Run: `npx vitest --run src/server/services/attachment-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/services/attachment-store.ts src/server/services/attachment-store.test.ts
git commit -m "feat(server): 聊天附件内存暂存与 prompt 注入格式化"
```

---

### Task 2: 后端 — POST /api/chat-attachments/upload 路由

**Files:**
- Create: `src/server/routes/chat-attachments.ts`
- Modify: `src/server/index.ts`（import :57 附近 + 注册 :273 附近）

**Step 1: 实现路由**（模式照抄 `src/server/routes/mineru.ts:26,53-91`）

```ts
/**
 * @file chat-attachments.ts
 * @description 聊天附件上传：文件经 MinerU 解析为 markdown 暂存，返回 attachmentId。
 */

import {Router} from 'express';
import multer from 'multer';
import type {MinerUService} from '../services/mineru-service.js';
import type {AttachmentStore} from '../services/attachment-store.js';
import {getErrorMessage} from '../utils/error-utils.js';

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 100 * 1024 * 1024}});

export function createChatAttachmentRoutes(mineruService: MinerUService, attachmentStore: AttachmentStore): Router {
    const router = Router();

    // POST /api/chat-attachments/upload — multipart 字段名 file，单文件
    router.post('/upload', upload.single('file'), async (req, res) => {
        try {
            const file = req.file;
            if (!file) {
                res.status(400).json({code: 'NO_FILE', message: 'No file uploaded'});
                return;
            }
            const result = await mineruService.parseBuffer(
                file.originalname,
                file.buffer,
                file.mimetype,
            );
            const markdown = result.markdown?.trim();
            if (!result.success || !markdown) {
                res.status(422).json({
                    code: 'PARSE_EMPTY',
                    message: `未能从文件「${file.originalname}」解析出文本内容`,
                });
                return;
            }
            const att = attachmentStore.save(file.originalname, markdown);
            res.json({attachmentId: att.id, fileName: att.fileName, chars: att.chars});
        } catch (err) {
            res.status(500).json({code: 'ATTACHMENT_PARSE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
```

**Step 2: 注册路由**（`src/server/index.ts`）

- import 区（:57 附近）加：`import {createChatAttachmentRoutes} from './routes/chat-attachments.js';` 与 `import {AttachmentStore} from './services/attachment-store.js';`
- 服务实例区（mineruService 创建处附近）加：`const attachmentStore = new AttachmentStore();`
- 注册区（:273 `app.use('/api/mineru', ...)` 旁）加：`app.use('/api/chat-attachments', createChatAttachmentRoutes(mineruService, attachmentStore));`
- 该实例需同时传给 Task 5 的各路由工厂（见 Task 5）。

**Step 3: 类型检查**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add src/server/routes/chat-attachments.ts src/server/index.ts
git commit -m "feat(server): 聊天附件上传路由——MinerU 解析后暂存返回 attachmentId"
```

---

### Task 3: 后端 — 权限模式三档贯通（TDD）

**Files:**
- Create: `src/server/services/permission-mapping.ts`（纯函数，可测）
- Test: `src/server/services/permission-mapping.test.ts`
- Modify: `src/server/services/cli-providers/types.ts`（CLIProviderOptions :217-240 加字段）
- Modify: `src/server/services/config-service.ts`（AppConfig cliProvider :66-84 加字段 + DEFAULT_CONFIG :126-131 + 若 cliProvider 有 schema 校验则同步扩展，搜索 `permissionMode` 之前的 cliProvider 校验段）
- Modify: `src/server/routes/system.ts`（GET /model-config :238 响应、PUT /model-config :262 入参）
- Modify: `src/server/services/cli-runner-service.ts`（runBridge :308-375 读配置注入）
- Modify: `src/server/services/cli-providers/claude-provider.ts`（payload 组装 :232-264）
- Modify: `src/bridge/claude-bridge.mjs`（:355-380 权限段）
- Modify: `src/server/services/cli-providers/pi-provider.ts`（:304-306）

**Step 1: 写失败测试**

```ts
import {describe, it, expect} from 'vitest';
import {resolveClaudePermission, resolvePiPermissionMode} from './permission-mapping.js';

describe('resolveClaudePermission', () => {
    it('bypass：完全放行，且不注入确认回调', () => {
        expect(resolveClaudePermission('bypassPermissions', true))
            .toEqual({permissionMode: 'bypassPermissions', permissionEnabled: false});
    });
    it('confirm + 有确认 UI：default + 启用回调', () => {
        expect(resolveClaudePermission('confirm', true))
            .toEqual({permissionMode: 'default', permissionEnabled: true});
    });
    it('confirm + 无确认 UI（经典流程）：退化为 acceptEdits，不启用回调', () => {
        expect(resolveClaudePermission('confirm', false))
            .toEqual({permissionMode: 'acceptEdits', permissionEnabled: false});
    });
    it('acceptEdits：接受编辑，回调按调用方决定', () => {
        expect(resolveClaudePermission('acceptEdits', true))
            .toEqual({permissionMode: 'acceptEdits', permissionEnabled: true});
        expect(resolveClaudePermission('acceptEdits', false))
            .toEqual({permissionMode: 'acceptEdits', permissionEnabled: false});
    });
});

describe('resolvePiPermissionMode', () => {
    it('confirm + 有确认 UI 才用 confirm，否则 auto-allow', () => {
        expect(resolvePiPermissionMode('confirm', true)).toBe('confirm');
        expect(resolvePiPermissionMode('confirm', false)).toBe('auto-allow');
        expect(resolvePiPermissionMode('acceptEdits', true)).toBe('auto-allow');
        expect(resolvePiPermissionMode('bypassPermissions', false)).toBe('auto-allow');
    });
});
```

Run: `npx vitest --run src/server/services/permission-mapping.test.ts` → FAIL

**Step 2: 实现纯函数**

```ts
/**
 * @file permission-mapping.ts
 * @description 全局权限模式到各引擎参数的映射（纯函数）。
 *   claude：confirm 需要确认 UI（onPermissionRequest）才能生效，否则退化为 acceptEdits；
 *   pi：只有 confirm/auto-allow 两档，acceptEdits 视作自动放行。
 */
export type PermissionMode = 'confirm' | 'acceptEdits' | 'bypassPermissions';

export function resolveClaudePermission(
    mode: PermissionMode,
    hasPermissionHandler: boolean,
): {permissionMode: string; permissionEnabled: boolean} {
    if (mode === 'bypassPermissions') {
        return {permissionMode: 'bypassPermissions', permissionEnabled: false};
    }
    if (mode === 'confirm' && !hasPermissionHandler) {
        return {permissionMode: 'acceptEdits', permissionEnabled: false};
    }
    return {permissionMode: mode, permissionEnabled: hasPermissionHandler};
}

export function resolvePiPermissionMode(mode: PermissionMode, hasPermissionHandler: boolean): 'confirm' | 'auto-allow' {
    return mode === 'confirm' && hasPermissionHandler ? 'confirm' : 'auto-allow';
}
```

Run 测试 → PASS。

**Step 3: 类型与配置贯通**

1. `cli-providers/types.ts` CLIProviderOptions（:227 onPermissionRequest 之后）加：
```ts
    /** 权限模式（全局配置）：confirm=工具调用需确认；acceptEdits=自动接受文件编辑；bypassPermissions=完全放行 */
    permissionMode?: 'confirm' | 'acceptEdits' | 'bypassPermissions';
```
2. `config-service.ts`：
   - AppConfig.cliProvider 内（`models` 字段后）加：
```ts
        /** 工具权限模式：confirm=询问确认（默认）；acceptEdits=自动接受文件编辑；bypassPermissions=完全放行 */
        permissionMode?: 'confirm' | 'acceptEdits' | 'bypassPermissions';
```
   - DEFAULT_CONFIG.cliProvider 加 `permissionMode: 'confirm',`
   - 若 cliProvider 段存在字段白名单式校验/迁移逻辑（v1 迁移附近），把 permissionMode 加入允许字段。
3. `system.ts`：
   - GET `/model-config`（:238-259）响应加 `permissionMode: config.cliProvider?.permissionMode ?? 'confirm'`。
   - PUT `/model-config`（:262 起）body 类型加 `permissionMode?: string`；校验 `['confirm','acceptEdits','bypassPermissions'].includes(...)`（非法则 400 VALIDATION_ERROR）；合法时写入 `config.cliProvider.permissionMode` 再持久化（沿用该 handler 现有的 config 读取/写入方式）。
4. `cli-runner-service.ts` runBridge（:323 try 块内，读 config 之后）：
```ts
        const permissionMode = config.cliProvider?.permissionMode ?? 'confirm';
```
   并在 :357-373 传给 provider 的 options 对象中加 `permissionMode,`（与 modelOptions 平级，独立于 modelRecordId 分支）。

**Step 4: claude-provider + bridge**

`claude-provider.ts` :232-264 payload 组装处：引入 `resolveClaudePermission`，把现有 `permissionEnabled: !!options?.onPermissionRequest`（:264）替换为：
```ts
        const perm = resolveClaudePermission(options?.permissionMode ?? 'confirm', !!options?.onPermissionRequest);
```
payload 增加 `permissionMode: perm.permissionMode`，`permissionEnabled: perm.permissionEnabled`。

`claude-bridge.mjs` :356-375：payload 解构处（已含 `permissionEnabled`）加 `permissionMode`；:365 `permissionMode: 'acceptEdits'` 改为 `permissionMode: permissionMode || 'acceptEdits'`；canUseTool 注入逻辑（:375 `if (permissionEnabled)`）不动。

**Step 5: pi-provider**

`pi-provider.ts` :304-306 替换为：
```ts
        // 权限模式：全局配置三档映射到 pi 的 confirm/auto-allow（经典流程无确认回调时自动放行）
        env.ADW_PERMISSION_MODE = resolvePiPermissionMode(
            options?.permissionMode ?? 'confirm',
            !!options?.onPermissionRequest,
        );
```
（顶部 import `resolvePiPermissionMode`。）

codex：不改动（无权限体系），选择器侧置灰。

**Step 6: 全量测试 + 类型检查**

Run: `npx vitest --run src/server/services/permission-mapping.test.ts && npx tsc -p tsconfig.server.json --noEmit`
Expected: PASS、无错误

**Step 7: Commit**

```bash
git add -A src/server src/bridge
git commit -m "feat(server): 权限模式三档全局配置贯通 cli-runner→claude bridge/pi"
```

---

### Task 4: 后端 — ASR 配置与 /api/asr/transcribe（TDD）

**Files:**
- Modify: `src/server/services/config-service.ts`（AppConfig :100 security 之前加 asr 段 + DEFAULT_CONFIG）
- Create: `src/server/routes/asr.ts`
- Test: `src/server/routes/asr.test.ts`
- Modify: `src/server/index.ts`（注册）

**Step 1: 配置结构**

AppConfig 加（mineru 段后）：
```ts
    /** 语音识别（ASR）配置：OpenAI 兼容 /audio/transcriptions 接口 */
    asr?: {
        /** 是否启用（默认 false） */
        enabled?: boolean;
        /** 服务基础地址（如 https://api.siliconflow.cn/v1），转发到 {apiUrl}/audio/transcriptions */
        apiUrl?: string;
        /** API Key（Bearer） */
        apiKey?: string;
        /** 模型名（默认 whisper-1） */
        model?: string;
    };
```
DEFAULT_CONFIG 加 `asr: {enabled: false},`。

**Step 2: 写失败测试**（mock global.fetch；用 express 应用挂路由 + supertest 风格。若项目未装 supertest，则用 node 内置 fetch 对临时 listen 的 server 发请求；先检查 `src/server/routes/mineru.ts` 是否有对应测试可模仿，没有就用下述裸 http 方式）

```ts
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import express from 'express';
import multer from 'multer';
import {createASRRoutes} from './asr.js';

// ConfigService 用 vi.mock 打桩，避免读真实配置文件
const loadMock = vi.fn();
vi.mock('../services/config-service.js', () => ({
    ConfigService: class { load() { return loadMock(); } },
}));

function post(app: express.Express, body: Buffer, boundary = '----x'): Promise<{status: number; json: any}> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const port = (server.address() as {port: number}).port;
            const payload = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
                body,
                Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);
            fetch(`http://127.0.0.1:${port}/transcribe`, {
                method: 'POST',
                headers: {'Content-Type': `multipart/form-data; boundary=${boundary}`},
                body: payload,
            }).then(async r => {
                const json = await r.json().catch(() => ({}));
                server.close();
                resolve({status: r.status, json});
            }).catch(reject);
        });
    });
}

describe('POST /api/asr/transcribe', () => {
    beforeEach(() => { loadMock.mockReset(); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('未启用时返回 ASR_NOT_CONFIGURED', async () => {
        loadMock.mockReturnValue({asr: {enabled: false}});
        const app = express();
        app.use('/api/asr', createASRRoutes());
        const {status, json} = await post(app, Buffer.from('x'));
        expect(status).toBe(400);
        expect(json.code).toBe('ASR_NOT_CONFIGURED');
    });

    it('转发上游并返回 text', async () => {
        loadMock.mockReturnValue({asr: {enabled: true, apiUrl: 'https://asr.test/v1', model: 'whisper-1'}});
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({text: '你好世界'}), {status: 200}));
        vi.stubGlobal('fetch', fetchMock);
        const app = express();
        app.use('/api/asr', createASRRoutes());
        const {status, json} = await post(app, Buffer.from('audio-bytes'));
        expect(status).toBe(200);
        expect(json.text).toBe('你好世界');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://asr.test/v1/audio/transcriptions');
        expect((init as any).body).toBeInstanceOf(FormData);
    });

    it('上游失败时透传 502', async () => {
        loadMock.mockReturnValue({asr: {enabled: true, apiUrl: 'https://asr.test/v1'}});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', {status: 401})));
        const app = express();
        app.use('/api/asr', createASRRoutes());
        const {status} = await post(app, Buffer.from('x'));
        expect(status).toBe(502);
    });
});
```

Run: `npx vitest --run src/server/routes/asr.test.ts` → FAIL

**Step 3: 实现路由**

```ts
/**
 * @file asr.ts
 * @description 语音识别路由：把前端录音转发到 OpenAI 兼容的 /audio/transcriptions 接口。
 */

import {Router} from 'express';
import multer from 'multer';
import {ConfigService} from '../services/config-service.js';
import {getErrorMessage} from '../utils/error-utils.js';

const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 25 * 1024 * 1024}});

export function createASRRoutes(): Router {
    const router = Router();

    // POST /api/asr/transcribe — multipart 字段名 audio
    router.post('/transcribe', upload.single('audio'), async (req, res) => {
        try {
            const asr = new ConfigService().load().asr;
            if (!asr?.enabled || !asr.apiUrl) {
                res.status(400).json({code: 'ASR_NOT_CONFIGURED', message: '未配置语音识别服务（config.asr.apiUrl）'});
                return;
            }
            const file = req.file;
            if (!file) {
                res.status(400).json({code: 'NO_FILE', message: 'No audio uploaded'});
                return;
            }

            const fd = new FormData();
            fd.append('file', new Blob([new Uint8Array(file.buffer)], {type: file.mimetype || 'audio/webm'}),
                file.originalname || 'audio.webm');
            fd.append('model', asr.model || 'whisper-1');

            const upstream = await fetch(`${asr.apiUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
                method: 'POST',
                ...(asr.apiKey ? {headers: {Authorization: `Bearer ${asr.apiKey}`}} : {}),
                body: fd,
            });
            if (!upstream.ok) {
                const detail = await upstream.text().catch(() => '');
                res.status(502).json({code: 'ASR_UPSTREAM_ERROR', message: `语音识别服务返回 ${upstream.status}`, detail: detail.slice(0, 500)});
                return;
            }
            const data = await upstream.json() as {text?: string};
            res.json({text: data.text ?? ''});
        } catch (err) {
            res.status(500).json({code: 'ASR_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
```

**Step 4: 注册**（index.ts）

`app.use('/api/asr', createASRRoutes());`（无需传依赖；import 路径 `./routes/asr.js`）

**Step 5: 运行测试 + 类型检查** → PASS

Run: `npx vitest --run src/server/routes/asr.test.ts && npx tsc -p tsconfig.server.json --noEmit`

**Step 6: Commit**

```bash
git add src/server/services/config-service.ts src/server/routes/asr.ts src/server/routes/asr.test.ts src/server/index.ts
git commit -m "feat(server): ASR 转写路由——OpenAI 兼容 /audio/transcriptions 可配置转发"
```

---

### Task 5: 后端 — 四个流程 reply/start 接入 attachmentIds 注入

**Files:**
- Modify: `src/server/routes/agent-execution.ts`（start :154、reply :213）
- Modify: `src/server/routes/execution.ts`（reply :648，prompt 组装 :695）
- Modify: `src/server/routes/plan.ts`（reply :1044，prompt 组装 :1072）
- Modify: `src/server/routes/projects.ts`（reply :198）
- Modify: `src/server/services/agent-coordinator.ts`（prompt 组装处注入）
- Modify: `src/server/index.ts`（把 attachmentStore 传给各路由工厂；工厂签名相应加参）

**统一约定：** 请求体新增可选 `attachmentIds?: string[]`；服务端 `attachmentStore.drain(ids)` 一次性取出，`formatAttachmentsBlock(docs)` 拼入 **发给引擎的 prompt**；对话日志只落 stub 行 `📎 已附加文档：a.pdf（1234 字）`，不落全文。

**Step 1: agent-execution 路由**

工厂签名加 `attachmentStore: AttachmentStore`（index.ts :275 的传入对象加 `attachmentStore`）。

- `/:id/start`（:154）：`const {message} = req.body` 后加：
```ts
            const docs = attachmentStore.drain((req.body?.attachmentIds ?? []) as string[]);
            if (docs.length > 0) {
                attachmentStore.bindPending(id, docs);
                await store.addLog(id, `📎 已附加文档：${docs.map(d => `${d.fileName}（${d.chars} 字）`).join('、')}`);
            }
```
- `/:id/reply`（:213）：同样在写日志/排队之前 drain + bindPending + 落 stub 日志（queued 分支也 bind，消费时由协调器取走）。message 长度校验逻辑不动。

**Step 2: agent-coordinator 注入**

在 `execute()` 中 userReplies 解析处（:173 `const userReplies = execution.logs...` 之后）加：
```ts
        const pendingDocs = this.attachments.takePending(executionId);
```
协调器构造函数 / config 增加 `attachments: AttachmentStore` 依赖（`AgentCoordinatorConfig` 类型加字段，index.ts 创建处传入）。

- `runSingleShot`（:484-496）签名加 `pendingDocs: StoredAttachment[]`：
  - `userReplies.length > 0` 两个分支：先把附件块追加到最后一条 reply —— 在方法开头加：
```ts
        if (pendingDocs.length > 0) {
            const block = formatAttachmentsBlock(pendingDocs);
            if (userReplies.length > 0) {
                userReplies[userReplies.length - 1] += block;
            } else {
                userReplies.push(`（已附加文档，请查阅附件内容）${block}`);
            }
        }
```
  （放在现有 prompt 组装之前即可对三个分支同时生效。）
- 子任务路径（runBridge :398 所在的循环）：若该路径也会消费排队回复拼 prompt（搜索 `PROMPTS.agentReply` 的所有 render 点），在每个 render 前对 replies 文本追加 `formatAttachmentsBlock(this.attachments.takePending(executionId))`；若该路径不消费用户回复则不需要处理。

**Step 3: execution 路由**

工厂加参 `attachmentStore`（index.ts :266 传入）。reply（:648）内：
```ts
            const docs = attachmentStore.drain((req.body?.attachmentIds ?? []) as string[]);
            const fullMessage = message + formatAttachmentsBlock(docs);
            if (docs.length > 0) {
                broadcast({type: 'log', data: {taskId: id, log: `📎 已附加文档：${docs.map(d => d.fileName).join('、')}`}});
            }
```
:695 的 `prompt: enrichPrompt(message, ...)` 改为 `prompt: enrichPrompt(fullMessage, ...)`；若该路由别处把 message 落对话日志，保持落原始 message（不含附件块）。broadcast 事件名以该文件现有 reply 日志广播方式为准（先读 :648-720 再改）。

**Step 4: plan 路由**

工厂加参 `attachmentStore`（index.ts :265 传入）。reply（:1044）：
```ts
        const docs = attachmentStore.drain((req.body?.attachmentIds ?? []) as string[]);
        const fullMessage = message + formatAttachmentsBlock(docs);
```
:1072 `prompt: enrichPrompt(message, ...)` → `enrichPrompt(fullMessage, ...)`；:1069 的 `broadcast({type: 'plan:progress', data: {taskId: plan.id, content: `\n\n**User:** ${message}\n\n`}})` 保持用原始 message（UI 不膨胀）。如 plan 记录用户消息到 plan.logs，同样落原始 message + 追加一行 stub。

**Step 5: projects/tasks 路由**

工厂加参 `attachmentStore`。reply（:198）：
```ts
        const docs = attachmentStore.drain((req.body?.attachmentIds ?? []) as string[]);
        const fullMessage = message + formatAttachmentsBlock(docs);
        ...
        const result = await taskScheduler.sendReply(req.params.taskId, fullMessage);
```

**Step 6: 类型检查**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: 无错误

**Step 7: Commit**

```bash
git add -A src/server
git commit -m "feat(server): 四流程 reply/start 支持附件注入——日志落 stub，prompt 注入全文"
```

---

### Task 6: 前端 — api helper 与 store 扩展

**Files:**
- Modify: `src/client/api.ts`（apiPost 后加 apiPostForm）
- Modify: `src/client/stores/app-store.ts`（cliProvider state :421-431、actions :840-940）

**Step 1: api.ts** 加：

```ts
/**
 * 发送 POST 请求（multipart/form-data）
 * @template T - 响应数据的类型
 * @param path - 请求路径（相对于 API_BASE）
 * @param form - FormData 请求体
 */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {method: 'POST', body: form});
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new ApiError(res.status, errBody);
    }
    return res.json();
}
```

**Step 2: app-store.ts**

1. state `cliProvider`（:421-431）加字段：`permissionMode: 'confirm' | 'acceptEdits' | 'bypassPermissions';`（初始 `'confirm'` :734-741）。
2. actions 接口（:550-556 附近）加：
```ts
    setPermissionMode: (mode: 'confirm' | 'acceptEdits' | 'bypassPermissions') => Promise<void>;
```
3. 实现（saveModelConfig :878 旁）：
```ts
        setPermissionMode: async (mode) => {
            const prev = get().cliProvider.permissionMode;
            set((state) => ({cliProvider: {...state.cliProvider, permissionMode: mode}}));
            try {
                await apiPut('/system/model-config', {permissionMode: mode});
            } catch {
                set((state) => ({cliProvider: {...state.cliProvider, permissionMode: prev}}));
                throw new Error('权限模式保存失败');
            }
        },
```
（确认文件内已有 `apiPut` import；GET /model-config 的 fetchModelConfig :857-876 解析处把 `data.permissionMode` 一并写入 state。）

**Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`（若无前端独立 tsconfig 则 `pnpm build:frontend` 验证）
Expected: 无错误

**Step 4: Commit**

```bash
git add src/client/api.ts src/client/stores/app-store.ts
git commit -m "feat(client): apiPostForm 与全局权限模式 store 状态"
```

---

### Task 7: 前端 — ChatInputBox 统一输入框组件

**Files:**
- Create: `src/client/components/ChatInputBox.tsx`
- Create: `src/client/components/input/ModelPicker.tsx`（Task 8）
- Create: `src/client/components/input/PermissionPicker.tsx`（Task 8）
- Create: `src/client/components/input/AttachmentButton.tsx`（Task 9）
- Create: `src/client/components/input/VoiceButton.tsx`（Task 9）

本 Task 先建组件骨架（textarea 卡片 + 键盘 + 工具栏占位 + 放大 + 优化），Task 8/9 填充四个控件。**代码从 `ExpandableTextarea.tsx` 移植放大弹窗（:172-198）与优化逻辑（:67-97）**。

**组件契约：**

```tsx
export interface PendingAttachment {
    attachmentId: string;
    fileName: string;
    chars: number;
}

interface ChatInputBoxProps {
    value: string;
    onChange: (v: string) => void;
    /** 发送（Enter 或点击发送按钮）。返回 Promise，resolve 后组件清空附件 chips */
    onSend: (text: string, attachments: PendingAttachment[]) => void | Promise<void>;
    disabled?: boolean;
    placeholder?: string;
    rows?: number;
    title?: string;
    optimizable?: boolean;
    optimizePurpose?: string;
    /** 页面特定动作按钮（暂停/终止/重试/清空日志等），渲染于工具栏右侧 */
    actions?: React.ReactNode;
    sending?: boolean;
    /** 页面级禁用发送（如运行中排队按钮自己的 disabled 逻辑） */
    sendDisabled?: boolean;
    /** 允许空文本发送（AgentExecutionPage 的「开始执行」） */
    allowEmptySend?: boolean;
    showModelPicker?: boolean;
    showPermissionPicker?: boolean;
    showAttachments?: boolean;
    showVoice?: boolean;
    /** 紧凑模式（ProjectsPage 抽屉） */
    compact?: boolean;
    wrapperClassName?: string;
}
```

**结构（Tailwind，shadcn 变量约定，玻璃拟态沿用 `glass-panel`）：**

```tsx
export const ChatInputBox = React.forwardRef<HTMLTextAreaElement, ChatInputBoxProps>((props, ref) => {
    const {
        value, onChange, onSend, disabled, placeholder, rows = 2, title,
        optimizable, optimizePurpose, actions, sending, sendDisabled, allowEmptySend,
        showModelPicker = true, showPermissionPicker = true, showAttachments = true, showVoice = true,
        compact, wrapperClassName = '',
    } = props;

    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const [expanded, setExpanded] = useState(false);
    // ...优化状态（移植 ExpandableTextarea :45-48）

    const canSend = !disabled && !sending && !sendDisabled
        && (value.trim().length > 0 || attachments.length > 0 || !!allowEmptySend);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter') return;
        // 中文输入法 composition 期间 Enter 是选词，不发送
        if (e.nativeEvent.isComposing) return;
        // Ctrl/Cmd+Enter 与 Shift+Enter 换行：走 textarea 默认行为
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!canSend) return;
        e.preventDefault();
        void submit();
    };

    const submit = async () => {
        if (!canSend) return;
        const atts = attachments;
        setAttachments([]);           // 乐观清空，失败由页面自行提示
        await onSend(value, atts);
    };
    // 注意：props.onChange('') 由页面在 onSend 内完成（保持页面现有清空逻辑）

    return (
        <div className={`relative min-w-0 ${wrapperClassName}`}>
            {/* 附件 chips 行 */}
            {showAttachments && attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5"> {/* chip: Paperclip + fileName + chars + X 移除 */} </div>
            )}

            {/* 输入卡片 */}
            <div className={`rounded-xl border border-border bg-background/80 shadow-sm transition-all
                focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15 ${disabled ? 'opacity-60' : ''}`}>
                <textarea
                    ref={ref}
                    value={value}
                    onChange={onChange}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder={placeholder}
                    rows={compact ? 1 : rows}
                    className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm leading-relaxed
                        focus:outline-none placeholder:text-muted-foreground/60"
                />
                {/* 底部工具栏 */}
                <div className="flex items-center gap-1 px-2 pb-2 pt-0.5 flex-wrap">
                    <div className="flex items-center gap-1 min-w-0 flex-wrap">
                        {showAttachments && <AttachmentButton ... />}
                        {showVoice && <VoiceButton ... />}
                        {showModelPicker && <ModelPicker />}
                        {showPermissionPicker && <PermissionPicker />}
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                        {optimizable && (/* Sparkles 按钮，移植 ExpandableTextarea :110-123 */}
                        )}
                        <button onClick={() => setExpanded(true)} title={t('common.chatInput.zoom')} aria-label={t('common.chatInput.zoom')}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                            <Maximize2 className="h-4 w-4"/>
                        </button>
                        {actions}
                        {/* 发送按钮 */}
                        <button
                            onClick={submit}
                            disabled={!canSend}
                            title={t('common.chatInput.send')}
                            aria-label={t('common.chatInput.send')}
                            className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground
                                shadow-sm transition-all hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none
                                active:scale-95"
                        >
                            {sending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}
                        </button>
                    </div>
                </div>
            </div>

            {/* 优化结果面板：整体移植 ExpandableTextarea :137-169 */}
            {/* 放大弹窗：整体移植 ExpandableTextarea :172-198，弹窗内 textarea 同样绑定 handleKeyDown 与 value/onChange */}
        </div>
    );
});
ChatInputBox.displayName = 'ChatInputBox';
```

要点：
- 文案全部走 i18n（`t('common.chatInput.*')`，Task 11 提供 key）。
- 悬浮放大/优化按钮改为工具栏常驻按钮（原来的 hover 浮层废弃）。
- 放大弹窗内 Enter 行为与主输入一致（同一 handleKeyDown）。
- 4 个子控件先以空占位组件接入（Task 8/9 实现），保证本 Task 可独立编译提交：
```tsx
// Task 7 阶段占位：export function ModelPicker() { return null; } 等
```

**Commit**

```bash
git add src/client/components/ChatInputBox.tsx src/client/components/input
git commit -m "feat(client): ChatInputBox 统一输入框骨架——Enter发送/Ctrl+Shift+Enter换行/IME保护/工具栏"
```

---

### Task 8: 前端 — ModelPicker 与 PermissionPicker

**Files:**
- Create: `src/client/components/input/ModelPicker.tsx`
- Create: `src/client/components/input/PermissionPicker.tsx`

**ModelPicker**（数据源与交互镜像 `Layout.tsx:316-348` + `ModelConfigModal.tsx` + `ProviderSetupModal.tsx:78`）：

```tsx
export function ModelPicker() {
    const active = useAppStore(s => s.cliProvider.active);
    const modelConfig = useAppStore(s => s.cliProvider.modelConfig);
    const providerCatalog = useAppStore(s => s.providerCatalog);
    const availableModels = useAppStore(s => s.availableModels);
    const piMeta = useAppStore(s => s.piMeta);
    const setCliProvider = useAppStore(s => s.setCliProvider);
    const setModelConfig = useAppStore(s => s.setModelConfig);
    const saveModelConfig = useAppStore(s => s.saveModelConfig);
    const fetchAvailableModels = useAppStore(s => s.fetchAvailableModels);
    const fetchModelConfig = useAppStore(s => s.fetchModelConfig);
    const setShowModelConfigModal = useAppStore(s => s.setShowModelConfigModal);
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭（移植 Layout 主题菜单 :358 的 ref 模式）
    useEffect(() => { ... document.addEventListener('mousedown', handler) ... }, []);

    const entry = providerCatalog.find(p => p.id === active);
    const config = modelConfig[active] ?? {};
    const tiers = availableModels[active]?.tiers;
    // 模型显示名：档位别名 → 实际模型名（镜像 Layout :339-346）；pi 用 piMeta.availableModels 匹配 name
    const modelLabel = ...;
    const modelOptions: Array<{value: string; label: string}> =
        entry?.id === 'pi'
            ? (piMeta?.availableModels ?? []).filter(m => m.provider === config.modelProvider).map(m => ({value: m.id, label: m.name || m.id}))
            : entry?.meta?.kind === 'custom'
                ? (entry.meta.models ?? []).map(m => ({value: m, label: m}))
                : (tiers ?? []).map(t => ({value: t.value, label: `${t.label} → ${t.model}`}));

    const selectProvider = async (id: string) => {
        setSwitching(true);
        try {
            await apiPost('/system/cli-provider/select', {providerId: id});
            setCliProvider(true, id);
            await fetchModelConfig();
            await fetchAvailableModels();
        } finally { setSwitching(false); }
    };

    const selectModel = async (model: string) => {
        setModelConfig(active, {model});
        await saveModelConfig(active, {...config, model});
        setOpen(false);
    };

    return (
        <div className="relative" ref={rootRef}>
            <button onClick={() => setOpen(!open)} disabled={switching}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-popover/60 px-2 text-[11px]
                    font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors max-w-44">
                <Cpu className="h-3.5 w-3.5 shrink-0"/>
                <span className="truncate">{entry?.label ?? active} · {modelLabel}</span>
                <ChevronDown className="h-3 w-3 shrink-0"/>
            </button>
            {open && (
                <div className="absolute bottom-full mb-2 left-0 z-[500] w-64 rounded-lg border border-border bg-popover p-1 shadow-apple-lg">
                    <p className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{t('common.chatInput.engine')}</p>
                    {providerCatalog.map(p => (
                        <button key={p.id} onClick={() => p.id !== active && selectProvider(p.id)}
                            className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                                p.id === active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                            {p.id === active ? <Check className="h-3.5 w-3.5"/> : <span className="w-3.5"/>}
                            <span className="truncate">{p.label}</span>
                            {!p.available && <span className="ml-auto text-[10px] text-amber-500">{t('common.chatInput.notDetected')}</span>}
                        </button>
                    ))}
                    {modelOptions.length > 0 && (
                        <>
                            <div className="my-1 h-px bg-border/60"/>
                            <p className="px-2 pt-0.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{t('common.chatInput.model')}</p>
                            <div className="max-h-56 overflow-y-auto">
                                {modelOptions.map(m => (
                                    <button key={m.value} onClick={() => selectModel(m.value)}
                                        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                                            m.value === config.model ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
                                        {m.value === config.model ? <Check className="h-3.5 w-3.5"/> : <span className="w-3.5"/>}
                                        <span className="truncate">{m.label}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <div className="my-1 h-px bg-border/60"/>
                    <button onClick={() => { setOpen(false); setShowModelConfigModal(true); }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                        <Settings2 className="h-3.5 w-3.5"/>{t('common.chatInput.openModelConfig')}
                    </button>
                </div>
            )}
        </div>
    );
}
```

注意：
- 弹出方向向上（`bottom-full mb-2`），输入框在页面底部。
- 「高级配置」依赖 Layout 已挂载的 `ModelConfigModal`（由 `cliProvider.showModelConfigModal` 驱动，store :846 已有 `setShowModelConfigModal`；确认 Layout.tsx :441-446 的 ModelConfigModal 常驻挂载——是的，它不条件卸载）。
- custom 引擎的 `meta.models` 类型在 store `ProviderCatalogEntry.meta` 中是 unknown，做安全收窄。
- 首次打开时若 `availableModels[active]` 为空，调用 `fetchAvailableModels()`。

**PermissionPicker：**

```tsx
const PERMISSION_OPTIONS = [
    {value: 'confirm', labelKey: 'common.chatInput.permConfirm', descKey: 'common.chatInput.permConfirmDesc', icon: Hand},
    {value: 'acceptEdits', labelKey: 'common.chatInput.permAcceptEdits', descKey: 'common.chatInput.permAcceptEditsDesc', icon: FileCheck},
    {value: 'bypassPermissions', labelKey: 'common.chatInput.permBypass', descKey: 'common.chatInput.permBypassDesc', icon: Zap},
] as const;

export function PermissionPicker() {
    const mode = useAppStore(s => s.cliProvider.permissionMode);
    const setPermissionMode = useAppStore(s => s.setPermissionMode);
    const active = useAppStore(s => s.cliProvider.active);
    // codex 与 custom 引擎不支持权限体系 → 置灰
    const supported = active === 'claude' || active === 'pi';
    const current = PERMISSION_OPTIONS.find(o => o.value === mode);
    return (
        <div className="relative">
            <button disabled={!supported}
                title={supported ? t('common.chatInput.permission') : t('common.chatInput.permUnsupported')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-popover/60 px-2 text-[11px]
                    font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors
                    disabled:opacity-40 disabled:pointer-events-none">
                <ShieldCheck className="h-3.5 w-3.5"/>
                <span className="hidden sm:inline">{supported ? t(current!.labelKey) : t('common.chatInput.permUnsupportedShort')}</span>
            </button>
            {/* open 弹层：三个选项（图标+label+desc 两行），选中高亮；点击即 setPermissionMode */}
        </div>
    );
}
```

**Commit**

```bash
git add src/client/components/input/ModelPicker.tsx src/client/components/input/PermissionPicker.tsx
git commit -m "feat(client): 输入框模型精简选择器与权限模式三档选择器"
```

---

### Task 9: 前端 — 附件上传与语音按钮

**Files:**
- Create: `src/client/components/input/AttachmentButton.tsx`
- Create: `src/client/components/input/VoiceButton.tsx`

**AttachmentButton**（上传模式参考 `RequirementsPage.tsx:296-298`，走 Task 6 的 `apiPostForm`）：

```tsx
export function AttachmentButton({onUploaded, disabled}: {
    onUploaded: (att: PendingAttachment) => void;
    disabled?: boolean;
}) {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const {t} = useTranslation();

    const handleFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        setError(null);
        try {
            for (const file of Array.from(files)) {
                const fd = new FormData();
                fd.append('file', file);
                const res = await apiPostForm<PendingAttachment>('/chat-attachments/upload', fd);
                onUploaded(res);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <>
            <input ref={inputRef} type="file" className="sr-only" multiple
                accept=".pdf,.docx,.doc,.pptx,.xlsx,.xls,image/*"
                onChange={(e) => handleFiles(e.target.files)}/>
            <button onClick={() => inputRef.current?.click()} disabled={disabled || uploading}
                title={t('common.chatInput.attach')} aria-label={t('common.chatInput.attach')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Paperclip className="h-4 w-4"/>}
            </button>
            {error && <span className="text-[11px] text-destructive max-w-40 truncate" title={error}>{error}</span>}
        </>
    );
}
```

错误展示用悬浮 title + 行内红字，3.5s 后自动清除（`setTimeout` 清 error，注意卸载清理）。

**VoiceButton**（MediaRecorder → `/api/asr/transcribe` → 插入文本）：

```tsx
export function VoiceButton({onText, disabled}: { onText: (text: string) => void; disabled?: boolean }) {
    const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
    const [error, setError] = useState<string | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const stopAndTranscribe = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;
        recorder.stop(); // onstop 里组装 blob 并转写
    }, []);

    const start = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
            const recorder = new MediaRecorder(stream, mime ? {mimeType: mime} : undefined);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                setState('transcribing');
                try {
                    const blob = new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'});
                    const fd = new FormData();
                    fd.append('audio', blob, 'speech.webm');
                    const res = await apiPostForm<{text: string}>('/asr/transcribe', fd);
                    if (res.text?.trim()) onText(res.text.trim());
                } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                } finally {
                    setState('idle');
                    recorderRef.current = null;
                }
            };
            recorder.start();
            recorderRef.current = recorder;
            setState('recording');
        } catch {
            setError(t('common.chatInput.micDenied'));
            setState('idle');
        }
    };

    return (
        <>
            <button onClick={() => (state === 'recording' ? stopAndTranscribe() : state === 'idle' && start())}
                disabled={disabled || state === 'transcribing'}
                title={t('common.chatInput.voice')}
                aria-label={t('common.chatInput.voice')}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40
                    ${state === 'recording'
                        ? 'bg-destructive/10 text-destructive animate-pulse'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                {state === 'transcribing' ? <Loader2 className="h-4 w-4 animate-spin"/> : <Mic className="h-4 w-4"/>}
            </button>
            {error && <span className="text-[11px] text-destructive">{error}</span>}
        </>
    );
}
```

ChatInputBox 内接线：`onText={(txt) => onChange(value ? `${value} ${txt}` : txt)}`；附件 chips 的删除按钮从 `attachments` state 移除对应项。

**Commit**

```bash
git add src/client/components/input/AttachmentButton.tsx src/client/components/input/VoiceButton.tsx
git commit -m "feat(client): 输入框附件上传与语音录音按钮"
```

---

### Task 10: 前端 — 四个页面迁移到 ChatInputBox

**Files:**
- Modify: `src/client/pages/AgentExecutionPage.tsx`（:1016-1088）
- Modify: `src/client/pages/ExecutionPage.tsx`（:795-903）
- Modify: `src/client/pages/PlanPage.tsx`（:1102-1146）
- Modify: `src/client/pages/ProjectsPage.tsx`（:340-356）
- Modify: 各页 API 调用补 `attachmentIds`

**Step 1: AgentExecutionPage（参考实现，后三页同构）**

替换 :1016-1088 的 `<div className="flex gap-2">…` 整块为：

```tsx
<ChatInputBox
    ref={undefined}
    value={replyText}
    onChange={setReplyText}
    onSend={async (text, atts) => {
        const attachmentIds = atts.map(a => a.attachmentId);
        if (canStart) {
            const message = text.trim() || undefined;
            await apiPost(`/agent-execution/${activeId}/start`, {message, attachmentIds: attachmentIds.length ? attachmentIds : undefined});
            loadDetail(activeId); loadHistory();
        } else {
            await handleReplyWithAttachments(text.trim(), attachmentIds);
        }
    }}
    disabled={!activeId}
    placeholder={canStart
        ? t('agents.inputStartPlaceholder')
        : isRunning
            ? t('agents.inputQueuePlaceholder')
            : t('agents.inputReplyPlaceholder')}
    rows={3}
    title="发送消息给 Agent"
    optimizable
    optimizePurpose="reply"
    allowEmptySend={canStart && !!activeId}
    sending={replying}
    sendDisabled={!canStart && isRunning && false /* 排队允许 */}
    actions={
        isRunning ? (
            <Button onClick={handleAbort} variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <Square className="h-4 w-4"/>
            </Button>
        ) : undefined
    }
    showModelPicker showPermissionPicker showAttachments showVoice
/>
```

- 原「开始执行 / 排队 / 发送」按钮职责并入发送按钮：`canStart` 时发送即 start（`allowEmptySend` 支持空文案启动）；`isRunning` 时发送即排队；其余即 reply。`sending={replying}` 沿用。
- `handleReply` 改造为接收参数：`handleReplyWithAttachments(text: string, attachmentIds: string[])`，body 传 `{message: text, attachmentIds}`；原有 `replying` loading 态保留。
- 原 `handleStart` 里对 `replyText` 的读取与清空逻辑保留（ChatInputBox 在 onSend 后由页面 `setReplyText('')` 清空，与现有 `handleReply` 的清空位置一致）。
- 排队消息条（:993-1015）与 ContextIndicator 保持原位（卡片头部）。

**Step 2: ExecutionPage**

- 替换 :795-815 的 ExpandableTextarea 与 :818-903 的按钮区为 ChatInputBox：
  - `disabled={isRunning}`（沿用原语义：运行中禁用输入）。
  - `actions`：运行中 → 暂停 + 中止（:818-837 两个按钮）；暂停/失败 → 重试 + 跳过 + 中止（:840-869）；完成且有 planId → 重新执行（:871-881）；清空日志 ghost 按钮（:894-901）也放进 actions。
  - `onSend={(text, atts) => handleReplyWithAttachments(text.trim(), atts.map(a => a.attachmentId))}`，`handleReply`（:522）加 `attachmentIds` 入参，POST body `{message, attachmentIds}`（:551）。
- 注意原按钮是 `self-end` 竖排布局，迁入工具栏后改为图标按钮（`size="icon"` 风格 + title），文案走 i18n。

**Step 3: PlanPage**

- 替换 :1102-1146 同构迁移：`disabled={generating}`；`actions`：generating → 暂停 + 取消；`handleReply`（:569）加 attachmentIds，POST `/plan/${activePlanId}/reply` body 加 `attachmentIds`（:580）。

**Step 4: ProjectsPage**

- 替换 :340-356 的裸 input + button：
```tsx
<ChatInputBox
    value={replyText}
    onChange={setReplyText}
    onSend={(text, atts) => handleReplyWithAttachments(text.trim(), atts.map(a => a.attachmentId))}
    placeholder={t('projects.replyPlaceholder')}
    rows={1}
    compact
    showModelPicker={false}   // 抽屉空间有限，精简
    showPermissionPicker={false}
    showAttachments
    showVoice
/>
```
- `handleReply`（:258）加 attachmentIds，POST `/tasks/${task.id}/reply` body 加。
- 仅 `task.status === 'running'` 时渲染（沿用 :339 条件）。

**Step 5: 删除 ExpandableTextarea**

```bash
grep -rn "ExpandableTextarea" src/client --include=*.tsx
```
Expected: 仅剩 `src/client/components/ExpandableTextarea.tsx` 自身（`src/client/index.css` 的命中是注释/类名则保留）。确认后删除该文件。

**Step 6: 类型检查 + 构建**

Run: `pnpm build:frontend`
Expected: 构建成功

**Step 7: Commit**

```bash
git add -A src/client
git commit -m "feat(client): 四页输入框统一迁移至 ChatInputBox，移除 ExpandableTextarea"
```

---

### Task 11: 前端 — i18n 文案（zh + en）

**Files:**
- Modify: `src/client/locales/zh.json`
- Modify: `src/client/locales/en.json`

`common` 命名空间下加 `chatInput` 组（两语言 key 完全对齐）：

```json
"chatInput": {
    "send": "发送",
    "attach": "上传附件（经 MinerU 解析）",
    "attachParsing": "解析中…",
    "removeAttachment": "移除附件",
    "voice": "语音输入",
    "micDenied": "无法访问麦克风，请检查浏览器/系统权限",
    "permission": "权限模式",
    "permConfirm": "询问确认",
    "permConfirmDesc": "敏感工具调用前弹窗确认",
    "permAcceptEdits": "自动接受编辑",
    "permAcceptEditsDesc": "文件编辑自动放行，其余工具仍需确认",
    "permBypass": "完全放行",
    "permBypassDesc": "所有工具调用自动批准，谨慎使用",
    "permUnsupported": "当前引擎不支持权限模式",
    "permUnsupportedShort": "不支持",
    "engine": "引擎",
    "model": "模型",
    "notDetected": "未检测",
    "openModelConfig": "高级配置…",
    "zoom": "放大编辑",
    "optimize": "优化提示词"
}
```

en 翻译：send / Attach (parsed by MinerU) / Parsing… / Remove attachment / Voice input / Cannot access microphone… / Permission mode / Ask always + desc / Auto-accept edits + desc / Bypass all + desc / Not supported by this engine / N/A / Engine / Model / Not detected / Advanced settings… / Zoom in / Optimize prompt。

页面私有 placeholder（agents.inputStartPlaceholder 等）若原有 key 可复用（`plan.replyPlaceholder` 等）则复用，不新增。

**Commit**

```bash
git add src/client/locales
git commit -m "feat(client): ChatInputBox 相关 i18n 文案（中英）"
```

---

### Task 12: 顶栏确认（无代码改动）

双入口方案下顶栏 Layout.tsx :316-348 两个按钮（Provider 切换、模型配置）**原样保留**，仅人工核对：输入框 ModelPicker 切换引擎/模型后，顶栏按钮的显示文本随之更新（两者同读 `cliProvider.active` / `modelConfig`，自动同步，无需改代码）。若发现顶栏 label 不刷新，检查 `fetchModelConfig` 后 `modelConfig` 是否更新（store :878-901）。

---

### Task 13: 端到端验证

**Step 1: 全量测试 + 构建**

```bash
pnpm test          # vitest --run：Task 1/3/4 新增测试 + 存量测试全绿
pnpm build         # frontend + backend + bridge 构建通过（类型检查兜底）
```

**Step 2: 启动开发环境**

```bash
pnpm dev
```
浏览器打开（Electron 桌面壳可后验，浏览器先验 web 模式）。

**Step 3: 手测清单（浏览器逐项验证）**

1. **快捷键**：四页分别验证——Enter 发送；Shift+Enter / Ctrl+Enter 换行；中文输入法打字选词（composition）时 Enter 不发送；输入为空时 Enter 不发送（无 allowEmptySend 场景）。
2. **附件**：Agent 页点📎选一个 PDF → chip 显示文件名与字数 → 输入"总结附件"发送 → 对话流出现 `📎 已附加文档：…` stub 而非全文；删除 chip 后发送不带附件；上传一个纯图片验证 MinerU OCR 路径；上传失败（如改名 .pdf 的文本文件）出现错误提示。
3. **权限模式**：Agent 页切换三档，刷新页面确认持久化；切到 `完全放行` 后启动一次执行，验证不再弹权限确认弹窗；切回 `询问确认` 后敏感操作重新弹窗；Active 引擎切到 codex 时选择器置灰。
4. **模型选择器**：输入框选择器切引擎（claude↔pi）→ 顶栏按钮 label 同步；切模型档位 → 顶栏显示同步；「高级配置…」打开原 ModelConfigModal；刷新后选择保持。
5. **语音**：在 `config.json` 配置 `asr.enabled=true, apiUrl`（任何 OpenAI 兼容端点）后，点麦克风录音→停止→识别文本追加进输入框；未配置时点击给出错误提示。
6. **回归**：三页放大编辑、提示词优化、排队消息条、ContextIndicator、暂停/终止/重试按钮均正常；ProjectsPage 抽屉输入正常发送。
7. **桌面壳抽查**：`pnpm dev:desktop` 起一次，确认输入框在 Electron 下键盘行为一致（窗口无焦点冲突）。

**Step 4: 收尾 Commit**

```bash
git add -A
git commit -m "chore: 统一输入框端到端验证通过"
```
（若有手测中发现的小修，一并在本提交内说明。）

---

## 风险与注意

1. **agent-coordinator 的注入点**：Task 5 Step 2 需实现者自行定位所有把用户回复文本拼入 prompt 的位置（`grep -n "PROMPTS.agentReply" src/server`），每处都要追加附件块；漏一处会导致排队消息的附件丢失。
2. **attachmentIds 一次性消费**：drain 取出即删。若路由在 drain 后、runBridge 前抛错，附件会丢——可接受（30min TTL 内存暂存，本就非持久），但不要在 drain 前做可失败的校验。
3. **pi 的 acceptEdits 语义**：pi 无"只自动接受编辑"档位，映射为 auto-allow（完全放行）。PermissionPicker 对 pi 可在 desc 中如实说明（i18n 已按通用描述写，接受此近似）。
4. **消息长度校验**：`/agent-execution/:id/reply` 的 10000 字上限针对用户输入文本，附件不在其中（服务端注入），无需调整。
5. **Electron 麦克风权限**：桌面壳需在 `session.setPermissionRequestHandler` 放行 `media`（若手测发现桌面端拿不到麦克风，在 `src/electron/main.ts` 补该 handler，一行改动）。
