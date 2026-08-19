// Host single-instance guard (mount-once pattern, own symbol for dsh-adw).
// The bundle namespaces its rows, but a standalone install of the same package
// side by side with an aggregate install would re-register the same webserver
// routes, tools, settings namespaces, and system-prompt sections and fail the
// boot. mountOnce makes the second host apply a no-op for the lifetime of the
// first instance.

const MOUNTED = Symbol.for('dsh-adw.mounted-plugins')

interface MountRegistry {
  [MOUNTED]?: Set<string>
}

function mountedSet(): Set<string> {
  const registry = globalThis as MountRegistry
  return (registry[MOUNTED] ??= new Set())
}

/**
 * Wrap a cordis plugin apply so the package runs at most once per process.
 * The first mount registers normally and unmarks when its fiber disposes;
 * any later mount of the same package name is a no-op.
 */
export function mountOnce<T extends (...args: any[]) => unknown>(packageName: string, fn: T): T {
  return ((...args: unknown[]) => {
    const mounted = mountedSet()
    if (mounted.has(packageName)) return
    mounted.add(packageName)
    const ctx = args[0] as { effect?: (effect: () => unknown) => unknown } | undefined
    ctx?.effect?.(() => () => {
      mounted.delete(packageName)
    })
    return fn(...args)
  }) as T
}
