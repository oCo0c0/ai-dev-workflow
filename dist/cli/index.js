"use strict";
/**
 * CLI 入口模块
 *
 * AI Dev Workbench 命令行入口。负责：
 * 1. 加载用户配置（~/.ai-dev-workbench/config.json）
 * 2. 查找可用端口
 * 3. 启动 HTTP/WebSocket 服务
 * 4. 注册优雅关闭处理（SIGINT/SIGTERM）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const port_finder_js_1 = require("./port-finder.js");
const banner_js_1 = require("./banner.js");
const server_1 = require("../server");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
/** 配置目录路径 */
const CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.ai-dev-workbench');
/** 配置文件路径 */
const CONFIG_FILE = path_1.default.join(CONFIG_DIR, 'config.json');
/**
 * 加载用户配置文件
 *
 * 从 ~/.ai-dev-workbench/config.json 读取配置。
 * 文件不存在或解析失败时返回空配置。
 *
 * @returns 解析后的应用配置对象
 */
function loadConfig() {
    try {
        if (fs_1.default.existsSync(CONFIG_FILE)) {
            const raw = fs_1.default.readFileSync(CONFIG_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    }
    catch {
        // 解析失败时忽略，使用默认配置
    }
    return {};
}
/**
 * 确保配置目录存在
 *
 * 若 ~/.ai-dev-workbench 目录不存在则递归创建。
 */
function ensureConfigDir() {
    if (!fs_1.default.existsSync(CONFIG_DIR)) {
        fs_1.default.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}
/**
 * 获取应用版本号
 *
 * 从 package.json 读取版本字段，读取失败时返回默认值 '0.1.0'。
 *
 * @returns 应用版本号字符串
 */
function getVersion() {
    try {
        const pkgPath = path_1.default.resolve(__dirname, '../../package.json');
        const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.1.0';
    }
    catch {
        return '0.1.0';
    }
}
/**
 * 启动 CLI 主流程
 *
 * 执行顺序：确保配置目录 → 加载配置 → 查找端口 → 创建服务 → 打印横幅 → 注册关闭信号
 */
async function startCLI() {
    ensureConfigDir();
    const config = loadConfig();
    const preferredPort = config.server?.port;
    const { port } = await (0, port_finder_js_1.findAvailablePort)({ preferredPort });
    const version = getVersion();
    const server = await (0, server_1.createServer)(port);
    (0, banner_js_1.printBanner)(port, version);
    // 优雅关闭处理
    const shutdown = () => {
        console.log('\n  Shutting down...');
        server.close(() => {
            process.exit(0);
        });
        // 5秒后强制退出
        setTimeout(() => process.exit(1), 5000);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
startCLI().catch((err) => {
    console.error('Failed to start AI Dev Workbench:', err.message);
    process.exit(1);
});
//# sourceMappingURL=index.js.map