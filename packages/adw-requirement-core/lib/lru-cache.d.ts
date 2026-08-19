/**
 * @module lru-cache
 * @description 简单 LRU 缓存，避免无界 Map 内存膨胀。
 * 超容量时按访问顺序淘汰最久未用项。
 */
export declare class LruCache<K, V> {
    private map;
    private readonly max;
    constructor(max?: number);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    has(key: K): boolean;
    clear(): void;
    get size(): number;
}
//# sourceMappingURL=lru-cache.d.ts.map