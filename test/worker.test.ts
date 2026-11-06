import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { describe, it } from 'node:test'

import { createWorker } from '../src/index.ts'

const RULES = 'https://rules.example.test/FAKE.txt'
const FILE = [
  '@format 1',
  '@hits https://edge.example.test/_edge/hits',
  '@host shop.example.test check=TOKEN report404',
  'shop.example.test/old\thttps://shop.example.test/new',
  'shop.example.test/*\thttps://www.example.test/\t302\tp',
  '',
].join('\n')

/** Serves the rules file and records report lines and other requests. */
function platform() {
  const lines: string[] = []
  const inits: Array<RequestInit | undefined> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    inits.push(init)
    if (url === RULES) return new Response(FILE, { headers: { ETag: '"r1"' } })
    lines.push(...gunzipSync(Buffer.from(init?.body as ArrayBuffer)).toString().split('\n').filter(Boolean))
    return new Response(null, { status: 204 })
  }
  return { fetch, lines, inits }
}

const context = () => {
  const work: Array<Promise<unknown>> = []
  return { waitUntil: (p: Promise<unknown>) => void work.push(p), done: () => Promise.all(work) }
}

describe('cloudflare', () => {
  it('serves rules before the origin, the catch-all on its 404, and reads the bindings per request', async () => {
    const p = platform()
    const origin: string[] = []
    const worker = createWorker<{ RULES_URL?: string; KEY?: string }>({
      settings: (env) => ({ rulesUrl: env.RULES_URL, key: env.KEY }),
      origin: async (request) => {
        origin.push(new URL(request.url).pathname)
        return new Response('page', { status: new URL(request.url).pathname === '/exists' ? 200 : 404 })
      },
      fetch: p.fetch,
      logger: null,
    })
    const env = { RULES_URL: RULES, KEY: 'k' }
    const ctx = context()
    const get = (path: string, ip = '192.0.2.1') => worker.fetch(new Request(`https://shop.example.test${path}`, { headers: { 'cf-connecting-ip': ip } }), env, ctx)

    assert.equal(await (await get('/_redirhub/check')).text(), 'token=TOKEN etag=r1')
    assert.equal((await get('/old')).headers.get('location'), 'https://shop.example.test/new')
    assert.equal((await get('/exists')).status, 200)
    const gone = await get('/gone/page')
    assert.equal(gone.status, 302)
    assert.equal(gone.headers.get('location'), 'https://www.example.test/gone/page')
    assert.deepEqual(origin, ['/exists', '/gone/page'])
    await ctx.done()
    assert.equal(p.lines.length, 2)
    assert.ok(p.lines.every((line) => line.startsWith('192.0.2.1 ')))

    const off = await worker.fetch(new Request('https://shop.example.test/old'), {}, ctx)
    assert.equal(off.status, 404, 'without settings every request goes to the origin')
  })
})
