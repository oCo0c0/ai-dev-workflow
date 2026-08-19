/**
 * Build script: bundles the host half (lib/index.js, ESM with @deepseek-ai/*
 * externals resolved at runtime from the profile) and the client half
 * (lib/client.js, the window.__ModuleLoader__ wrapper format the dsh web GUI
 * loads from /plugins/<id>/client.js).
 *
 * esbuild is invoked as a DIRECT child process with stdio inherit (never
 * through the JS API): some sandboxed environments forbid piped-stdio
 * children, and inherit-mode spawns are universally allowed.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const exe = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'

/** Locate the esbuild platform binary inside the pnpm layout. */
function findEsbuild() {
  const candidates = []
  const nm = path.join(root, 'node_modules')
  // direct layout: node_modules/@esbuild/<platform>/esbuild(.exe)
  const scoped = path.join(nm, '@esbuild')
  if (fs.existsSync(scoped)) {
    for (const dir of fs.readdirSync(scoped)) {
      const p = path.join(scoped, dir, exe)
      if (fs.existsSync(p)) candidates.push(p)
    }
  }
  // pnpm isolated layout: node_modules/.pnpm/@esbuild+<platform>@*/node_modules/@esbuild/<platform>/esbuild(.exe)
  const pnpmDir = path.join(nm, '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('@esbuild+')) continue
      const inner = path.join(pnpmDir, entry, 'node_modules', '@esbuild')
      if (!fs.existsSync(inner)) continue
      for (const dir of fs.readdirSync(inner)) {
        const p = path.join(inner, dir, exe)
        if (fs.existsSync(p)) candidates.push(p)
      }
    }
  }
  if (candidates.length === 0) throw new Error('esbuild binary not found — run pnpm install first')
  return candidates[0]
}

/** Run esbuild with inherit stdio; throws with stderr tail on failure. */
function runEsbuild(args) {
  const result = spawnSync(findEsbuild(), args, { stdio: 'inherit', cwd: root })
  if (result.status !== 0) throw new Error(`esbuild failed with status ${result.status}: ${args.join(' ')}`)
}

/** Client-bundle wrapper pieces (the dsh web client-module format). */
const BANNER = `window.__ModuleLoader__.load({
	id: "@along/dsh-adw",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`
const FOOTER = `
		return module.exports;
	}
});
`

// ── host half ───────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
runEsbuild([
  'src/index.ts',
  '--bundle', '--format=esm', '--platform=node', '--target=es2022',
  '--outfile=lib/index.js', '--sourcemap',
  '--external:@deepseek-ai/*', '--external:schemastery',
  // ESM output that inlines CJS deps (MCP SDK → cross-spawn) needs a real
  // require for node builtins — the canonical esbuild interop banner.
  '--banner:js=import { createRequire as __dshAdwCr } from \'node:module\'; const require = __dshAdwCr(import.meta.url);',
  '--alias:@along/adw-requirement-core=' + path.resolve(root, '../adw-requirement-core/src/index.ts'),
  '--log-level=warning',
])

// ── client half ─────────────────────────────────────────────────────────────
runEsbuild([
  'src/client/index.ts',
  '--bundle', '--format=cjs', '--platform=browser', '--target=es2022',
  '--jsx=automatic',
  '--outfile=lib/.client-body.js', '--sourcemap',
  '--external:react', '--external:react-dom/client', '--external:react/jsx-runtime',
  '--external:@deepseek-ai/*',
  '--log-level=warning',
])
const body = fs.readFileSync(path.join(root, 'lib/.client-body.js'), 'utf8')
fs.writeFileSync(path.join(root, 'lib/client.js'), BANNER + body + FOOTER, 'utf8')
// Repair the sourcemap reference: esbuild wrote `.client-body.js.map`; rebind
// it to client.js.map so browser devtools find it under the real filename.
const mapPath = path.join(root, 'lib/.client-body.js.map')
if (fs.existsSync(mapPath)) {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  map.file = 'client.js'
  fs.writeFileSync(path.join(root, 'lib/client.js.map'), JSON.stringify(map), 'utf8')
  fs.rmSync(mapPath, { force: true })
}
fs.rmSync(path.join(root, 'lib/.client-body.js'), { force: true })

console.log('built lib/index.js + lib/client.js')
