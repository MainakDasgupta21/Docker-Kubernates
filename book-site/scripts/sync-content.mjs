import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const siteRoot = join(__dirname, '..')
const bookRoot = join(siteRoot, '..', 'mastering-docker-k8s-book')
const docsRoot = join(siteRoot, 'docs')

function shouldCopy(src) {
  const base = src.replace(/\\/g, '/')
  if (base.includes('/node_modules')) return false
  if (base.includes('/.vitepress')) return false
  if (base.endsWith('STYLE-GUIDE.md')) return false
  if (base.endsWith('assets/README.md')) return false
  // Prefer interactive home (index.md); skip GitHub README as a docs route
  if (/\/README\.md$/i.test(base) && !base.includes('/assets/')) return false
  return true
}

function rewriteFenceLanguages(root) {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        stack.push(p)
        continue
      }
      if (!name.endsWith('.md')) continue
      const text = readFileSync(p, 'utf8')
      const next = text.replace(/```gotemplate/g, '```go')
      if (next !== text) writeFileSync(p, next, 'utf8')
    }
  }
}

function sync() {
  if (existsSync(docsRoot)) {
    rmSync(docsRoot, { recursive: true, force: true })
  }
  mkdirSync(docsRoot, { recursive: true })

  cpSync(bookRoot, docsRoot, {
    recursive: true,
    filter: shouldCopy,
  })

  writeFileSync(
    join(docsRoot, '.synced-from'),
    `Synced from mastering-docker-k8s-book at ${new Date().toISOString()}\n`,
    'utf8',
  )

  // Interactive home lives only in the reader (not in the GitHub markdown book).
  writeFileSync(
    join(docsRoot, 'index.md'),
    `---
layout: page
sidebar: false
outline: false
title: Zero to Production
description: Mastering Docker and Kubernetes — from first principles to day-2 SRE.
---

<HomePage />
`,
    'utf8',
  )

  rewriteFenceLanguages(docsRoot)
  console.log(`Synced book → ${docsRoot}`)
}

sync()
