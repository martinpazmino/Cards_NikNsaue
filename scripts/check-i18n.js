// Verifies every t('key') used in src/ exists in both languages.
// Usage: node scripts/check-i18n.js

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { STRINGS } from '../src/lib/strings.js'

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(p) ? [p] : []
  })
}

export function checkI18n() {
  const problems = []
  const used = new Set()
  for (const file of files('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\bt\(\s*['`]([\w.]+)['`]/g)) used.add(m[1])
    for (const m of src.matchAll(/\bt\(`([\w.]*)\$\{/g)) used.add(`${m[1]}*`)
  }
  for (const key of used) {
    if (key.endsWith('*')) continue
    for (const lang of Object.keys(STRINGS)) if (!(key in STRINGS[lang])) problems.push(`missing ${lang}: ${key}`)
  }
  const es = Object.keys(STRINGS.es)
  const en = Object.keys(STRINGS.en)
  for (const k of es) if (!en.includes(k)) problems.push(`only in es: ${k}`)
  for (const k of en) if (!es.includes(k)) problems.push(`only in en: ${k}`)
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkI18n()
  for (const p of problems) console.log('✗', p)
  console.log(problems.length ? `${problems.length} problem(s)` : '✓ translations OK')
  process.exit(problems.length ? 1 : 0)
}
