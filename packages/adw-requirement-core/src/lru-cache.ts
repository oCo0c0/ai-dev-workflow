/**
 * @module lru-cache
 * @description 简单 LRU 缓存，避免无界 Map 内存膨胀。
 * 超容量时按访问顺序淘汰最久未用项。
 */
export class LruCache<K, V> {
    private map = new Map<K, V>();
    private readonly max: number;

    constructor(max = 100) {
        this.max = max;
    }

    get(key: K): V | undefined {
        const v = this.map.get(key);
        if (v === undefined) return undefined;
        // 命中 → 移到最新（Map 保持插入顺序，reinsert 实现 LRU）
        this.map.delete(key);
        this.map.set(key, v);
        return v;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, value);
        // 超容淘汰最旧
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value as K;
            this.map.delete(oldest);
        }
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}
