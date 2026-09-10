/**
 * 桌面版后端服务引导脚本
 *
 * 由 Electron 主进程以 ELECTRON_RUN_AS_NODE=1 方式启动
 * （process.execPath 即 Electron 二进制，作为纯 Node 运行时使用）。
 *
 * 职责：
 * 1. 删除 ELECTRON_RUN_AS_NODE 环境变量，避免泄漏给后端派生的下游子进程
 *   （bridge / pi RPC / MCP servers）；同类 Electron 程序若误读该变量会异常
 * 2. 开发模式经 tsx 直跑 TypeScript 源码；生产加载编译产物 dist/cli
 */

import path from 'path';

delete process.env.ELECTRON_RUN_AS_NODE;
process.env.ADW_DESKTOP = '1';

const isDev = process.env.ADW_ELECTRON_DEV === '1';
// 本文件编译产物位于 dist-electron/electron/，仓库根为其上两级
const entry = isDev
    ? path.resolve(__dirname, '../../src/cli/index.ts')
    : path.resolve(__dirname, '../../dist/cli/index.js');

if (isDev) {
    // 注册 tsx 的 CJS require 钩子后即可直接 require TS 源码
    require('tsx/cjs');
}
require(entry);
