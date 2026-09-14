import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import express from 'express';
import {createASRRoutes} from './asr.js';

// ConfigService 用 vi.mock 打桩，避免读真实配置文件
const loadMock = vi.fn();
vi.mock('../services/config-service.js', () => ({
    ConfigService: class { load() { return loadMock(); } },
}));

// 捕获未被 stub 的真实 fetch，供 helper 向本地服务器发请求
//（vi.stubGlobal('fetch', …) 会替换 globalThis.fetch，不能让 helper 也走 mock）
const realFetch = globalThis.fetch;

function post(app: express.Express, body: Buffer, boundary = '----x'): Promise<{status: number; json: any}> {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const port = (server.address() as {port: number}).port;
            const payload = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
                body,
                Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);
            realFetch(`http://127.0.0.1:${port}/api/asr/transcribe`, {
                method: 'POST',
                headers: {'Content-Type': `multipart/form-data; boundary=${boundary}`},
                body: payload,
            }).then(async r => {
                const json = await r.json().catch(() => ({}));
                server.close();
                server.closeAllConnections?.();
                resolve({status: r.status, json});
            }).catch(reject);
        });
    });
}

describe('POST /api/asr/transcribe', () => {
    beforeEach(() => { loadMock.mockReset(); });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

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
