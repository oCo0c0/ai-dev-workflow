"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LruCache = void 0;
/**
 * @module lru-cache
 * @description 简单 LRU 缓存，避免无界 Map 内存膨胀。
 * 超容量时按访问顺序淘汰最久未用项。
 */
class LruCache {
    map = new Map();
    max;
    constructor(max = 100) {
        this.max = max;
    }
    get(key) {
        const v = this.map.get(key);
        if (v === undefined)
            return undefined;
        // 命中 → 移到最新（Map 保持插入顺序，reinsert 实现 LRU）
        this.map.delete(key);
        this.map.set(key, v);
        return v;
    }
    set(key, value) {
        if (this.map.has(key))
            this.map.delete(key);
        this.map.set(key, value);
        // 超容淘汰最旧
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            this.map.delete(oldest);
        }
    }
    delete(key) {
        return this.map.delete(key);
    }
    has(key) {
        return this.map.has(key);
    }
    clear() {
        this.map.clear();
    }
    get size() {
        return this.map.size;
    }
}
exports.LruCache = LruCache;
//# sourceMappingURL=lru-cache.js.map