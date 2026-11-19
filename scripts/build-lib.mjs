// npm run build:lib: the package's dist, from nothing. tsc emits each module with its declarations, the declarations'
// .ts imports are made .js, as tsc leaves them, and Vite makes the two single-file builds of the core. It fails if a
// declaration still imports a .ts file
import { spawnSync } from 'node:child_process'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const bin = (name) => join(root, 'node_modules', '.bin', name)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await rm(dist, { recursive: true, force: true })
run(bin('tsc'), ['-p', 'tsconfig.lib.json'])

// A relative import of a .ts or .tsx file, in an import, an export or an import() type
const SPECIFIER = /((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)\.tsx?(['"])/g
let rewritten = 0
for (const name of await readdir(dist)) {
  if (!name.endsWith('.d.ts')) continue
  const path = join(dist, name)
  const text = await readFile(path, 'utf8')
  const fixed = text.replace(SPECIFIER, (_, before, specifier, after) => `${before}${specifier}.js${after}`)
  if (fixed !== text) {
    rewritten += 1
    await writeFile(path, fixed)
  }
  if (/['"]\.{1,2}\/[^'"]+\.tsx?['"]/.test(fixed)) {
    console.error(`dist/${name} still imports a .ts file`)
    process.exit(1)
  }
}
console.log(`declarations: ${rewritten} rewritten to import .js`)

run(bin('vite'), ['build', '--config', 'vite.standalone.config.ts', '--logLevel', 'warn'])
run(bin('vite'), ['build', '--config', 'vite.standalone.config.ts', '--mode', 'global', '--logLevel', 'warn'])
