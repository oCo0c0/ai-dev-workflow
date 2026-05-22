/** JSON 存储配置 */
export interface JsonStoreConfig {
    /** 存储文件默认路径 */
    defaultPath: string;
    /** 最大记录数，Infinity 表示不限制 */
    maxRecords: number;
    /** 排序字段（日期类型字段名），留空则不排序 */
    sortField?: string;
}
/**
 * JSON 文件存储基类
 *
 * 封装了 JSON 文件持久化的通用逻辑：目录创建、容错读取、排序截断写入和 CRUD 操作。
 * 子类通过构造函数传入配置（文件路径、记录上限、排序字段）即可复用全部能力。
 *
 * @typeParam T - 记录类型，必须包含 `id: string` 字段
 *
 * @example
 * ```typescript
 * interface MyItem { id: string; name: string; createdAt: string }
 *
 * class MyStore extends JsonStore<MyItem> {
 *   constructor(file?: string) {
 *     super({ defaultPath: '/path/to/items.json', maxRecords: 50, sortField: 'createdAt' }, file);
 *   }
 * }
 * ```
 */
export declare class JsonStore<T extends {
    id: string;
}> {
    protected readonly storeFile: string;
    private readonly maxRecords;
    private readonly sortField;
    constructor(config: JsonStoreConfig, storeFile?: string);
    /** 确保存储目录存在，不存在则递归创建 */
    protected ensureDir(): void;
    /**
     * 从磁盘加载记录数组（容错处理）
     *
     * 容错策略：
     * - 文件不存在时返回空数组
     * - JSON 解析失败时静默返回空数组
     * - 解析结果不是数组时返回空数组
     */
    protected load(): T[];
    /**
     * 保存记录数组到磁盘
     *
     * 保存前自动按配置的 sortField 倒序排列，并截断到 maxRecords 条。
     * 子类可覆盖此方法实现自定义保存逻辑。
     */
    protected save(items: T[]): void;
    /** 按 sortField 倒序排列（原地排序） */
    private sortByField;
    /**
     * 列出所有记录（按 sortField 倒序）
     * @param limit - 可选，限制返回数量
     */
    list(limit?: number): T[];
    /** 根据 ID 获取单条记录 */
    get(id: string): T | undefined;
    /** 创建或更新记录（Upsert 语义） */
    upsert(item: T): T;
    /** 根据 ID 删除记录 */
    delete(id: string): boolean;
}
//# sourceMappingURL=json-store.d.ts.map