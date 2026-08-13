/**
 * @module crypto-utils
 * @description 敏感信息加密工具
 *
 * 使用 Node.js 内置 crypto 模块的 AES-256-GCM 算法对 API Key 等敏感信息做静态加密。
 * 加密密钥持久化在应用数据目录下的 .secret-key 文件中（权限 0600）。
 *
 * 设计要点：
 * - 密钥首次使用时自动生成（32 字节随机数），跨进程稳定复用
 * - 支持通过环境变量 ADW_SECRET_KEY_FILE 覆盖密钥文件路径（测试用）
 * - 密文格式 `enc:v1:<iv>.<authTag>.<cipher>`（base64），自描述、可校验
 * - 解密失败时抛出明确错误，避免静默返回错误密钥
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {SECRET_KEY_FILE} from './constants.js';

/** AES-256-GCM 算法标识 */
const ALGORITHM = 'aes-256-gcm';
/** 密钥长度（字节） */
const KEY_LENGTH = 32;
/** 密文前缀 */
const PREFIX = 'enc:v1';

/**
 * 获取密钥文件路径
 * 优先读取环境变量 ADW_SECRET_KEY_FILE（便于测试注入临时目录），否则使用默认路径。
 */
export function getSecretKeyFile(): string {
    return process.env.ADW_SECRET_KEY_FILE || SECRET_KEY_FILE;
}

/**
 * 从指定文件读取或创建加密密钥
 *
 * 若密钥文件不存在，则生成新的 32 字节随机密钥并写入磁盘（权限 0600）。
 * 密钥文件存在但内容非法时抛错而非静默重建，避免旧密文不可逆地无法解密。
 *
 * @param file - 密钥文件绝对路径
 * @returns 32 字节的加密密钥 Buffer
 */
export function getOrCreateSecretKeyFromFile(file: string): Buffer {
    if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8').trim();
        if (raw) {
            const buf = Buffer.from(raw, 'base64');
            if (buf.length === KEY_LENGTH) return buf;
        }
        // 密钥文件存在但内容非法：拒绝覆盖，抛出明确错误让用户处理
        throw new Error(`Secret key file is invalid: ${file}`);
    }

    const key = crypto.randomBytes(KEY_LENGTH);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, key.toString('base64'), {encoding: 'utf-8', mode: 0o600});
    return key;
}

/**
 * 读取或创建默认加密密钥
 *
 * @returns 32 字节的加密密钥 Buffer
 */
export function getOrCreateSecretKey(): Buffer {
    return getOrCreateSecretKeyFromFile(getSecretKeyFile());
}

/**
 * 加密明文字符串
 *
 * @param plaintext - 明文字符串
 * @param key - 可选，32 字节密钥；缺省时读取/创建默认密钥
 * @returns `enc:v1:<iv>.<authTag>.<cipher>` 格式的密文
 */
export function encryptSecret(plaintext: string, key?: Buffer): string {
    const secret = key ?? getOrCreateSecretKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, secret, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}:${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
}

/**
 * 解密由 encryptSecret 生成的密文
 *
 * @param payload - `enc:v1:<iv>.<authTag>.<cipher>` 格式的密文
 * @param key - 可选，32 字节密钥；缺省时读取默认密钥
 * @returns 明文字符串
 * @throws {Error} 密文格式非法或解密失败时抛出
 */
export function decryptSecret(payload: string, key?: Buffer): string {
    if (!payload || typeof payload !== 'string') {
        throw new Error('Encrypted payload must be a non-empty string');
    }
    const parts = payload.split(':');
    // 格式：enc:v1:<iv>.<authTag>.<cipher>
    if (parts.length !== 3 || parts[0] !== 'enc' || parts[1] !== 'v1') {
        // 本项目首次引入，无历史包袱，格式不符直接报错
        throw new Error('Unsupported encrypted payload format');
    }

    const [ivB64, tagB64, dataB64] = parts[2].split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
        throw new Error('Malformed encrypted payload');
    }

    const secret = key ?? getOrCreateSecretKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, secret, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
    ]);
    return plaintext.toString('utf-8');
}

/**
 * 判断字符串是否为加密密文
 */
export function isEncrypted(payload: string): boolean {
    return typeof payload === 'string' && payload.startsWith(`${PREFIX}:`);
}
