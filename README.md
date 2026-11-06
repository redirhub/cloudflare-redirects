# cloudflare-redirects: bulk redirects for Cloudflare Workers

[![npm](https://img.shields.io/npm/v/@redirhub/cloudflare-redirects)](https://www.npmjs.com/package/@redirhub/cloudflare-redirects)
[![CI](https://github.com/redirhub/cloudflare-redirects/actions/workflows/ci.yml/badge.svg)](https://github.com/redirhub/cloudflare-redirects/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Serve thousands of 301 and 302 redirects from a [Cloudflare Worker](https://workers.cloudflare.com)
in front of your origin, from a remote rules file, and monitor its 404s.** Old URLs, short links and
whole website migrations redirect at Cloudflare's edge; every redirect and every 404 is reported
back, so broken links show up before your visitors find them.

- Redirects, short links and whole website migrations, live within a minute, without
  redeploying the Worker.
- 404 monitoring: the origin's 404s that no rule redirected are reported in the background.
- Fails open: no rules yet, a download error or a bug never breaks a page; the request goes on to
  the origin.
- Reports go out in the background (`ctx.waitUntil`), batched, without delaying a response.
- No dependencies.

The rules file format is open: [Integration Mode format v1](https://github.com/redirhub/integration-spec),
and this package passes its [golden sample](spec/v1). [RedirHub](https://www.redirhub.com)
publishes the file for you: you manage the redirects in its dashboard, API or MCP server and see
the redirects and 404s in its analytics.

## For AI coding assistants

To put this in front of a site on Cloudflare:

1. `npm install @redirhub/cloudflare-redirects` in a Worker project.
2. `export default createWorker({ settings: (env) => ({ rulesUrl: env.ACME_RULES_URL, key: env.ACME_INTEGRATION_KEY }) })`
   as the Worker's entry; pass `origin` only if requests should go somewhere other than `fetch(request)`.
3. In `wrangler.toml`: a route `<hostname>/*` on the zone, the rules address as a plain `[vars]`
   value, and the integration key as a secret (`wrangler secret put ACME_INTEGRATION_KEY`). Names
   come from the RedirHub dashboard.
4. Check: `GET https://<hostname>/_redirhub/check` answers `token=… etag=…`, and a rule's path
   redirects with its status. Then press **Check now** in the dashboard.

Do not reimplement the rules format: this package passes the specification's golden sample.

## When to use it

Cloudflare's own Redirect Rules and Bulk Redirects are managed in the Cloudflare dashboard or API.
This Worker is for redirect lists managed elsewhere, by people who do not touch Cloudflare: a
website migration with thousands of old URLs, marketing and short links, the same rules across
several zones or accounts. It also does what a list cannot: a catch-all only where your origin
answers 404 (a working page is never taken over), and reports of every redirect and 404. The rules
change in a dashboard, API or MCP server, and every isolate picks them up within a minute.

## Install

```sh
npm install @redirhub/cloudflare-redirects
```

In the RedirHub dashboard, add the domain, pick **Connect through your own platform**, and copy
the **rules address** and the **integration key**. The examples call the settings
`ACME_RULES_URL` and `ACME_INTEGRATION_KEY` (the dashboard shows the names for your platform).

## Use

`src/index.ts`:

```ts
import { createWorker } from '@redirhub/cloudflare-redirects'

interface Env {
  ACME_RULES_URL: string
  ACME_INTEGRATION_KEY: string
}

export default createWorker<Env>({
  settings: (env) => ({ rulesUrl: env.ACME_RULES_URL, key: env.ACME_INTEGRATION_KEY }),
})
```

`wrangler.toml`:

```toml
name = "shop-redirects"
main = "src/index.ts"
compatibility_date = "2026-11-01"
routes = [{ pattern = "shop.example.com/*", zone_name = "example.com" }]

[vars]
ACME_RULES_URL = "https://rules.example.com/…/TOKEN.txt"
```

```sh
npx wrangler secret put ACME_INTEGRATION_KEY
npx wrangler deploy
```

The rules address is not a secret (just don't publish it); the key is (it authenticates your
reports), so it goes in a Worker secret, `.dev.vars` locally.

Requests that no rule answers go to the origin, `fetch(request)`. To send them elsewhere, or to
add your own logic, pass `origin: (request, env, ctx) => …`.

| Option | |
| --- | --- |
| `settings(env)` | The rules address and the key from the Worker's bindings. Empty address: off, every request goes to the origin. |
| `origin(request, env, ctx)` | Where requests no rule answers go; default `fetch(request)`. |
| `report404` | `rules` (default): 404s of hostnames with **Report 404 pages** on; `all`: every hostname the Worker serves. |
| `hostname(request)` | The hostname to look up in the rules; `null` leaves the request alone (straight to the origin, nothing reported). Default the `Host` header. |
| `path(request)` | The path the visitor asked for, percent-encoded; `null` leaves the request alone. Default the request URL's path. |
| `clientIp(request)` | The visitor's address in reports; default `CF-Connecting-IP`. `null` writes `-`. |
| `userAgent(request)` | The User-Agent in reports; default the `User-Agent` header. `null` writes `-`. |
| `anonymizeIp` | Report IPv4 with the last byte zeroed, IPv6 cut to /48. |
| `logger` | Default `console`; `null` for silence. Failures are logged at most once per ten minutes. |

## Customize

Each option that reads the request is a function of it, so a Worker decides with ordinary code:

```ts
export default createWorker<Env>({
  settings: (env) => ({ rulesUrl: env.ACME_RULES_URL, key: env.ACME_INTEGRATION_KEY }),
  // Which hostname to look up in the rules. null: leave the request alone.
  hostname: (request) => {
    const host = new URL(request.url).hostname
    if (host === 'api.example.com') return null // never through the rules
    if (host.endsWith('.workers.dev')) return 'shop.example.com' // testing on workers.dev
    return host
  },
  // Paths that never go through the rules.
  path: (request) => {
    const { pathname } = new URL(request.url)
    return pathname.startsWith('/api/') ? null : pathname
  },
  userAgent: (request) => request.headers.get('user-agent'),
  anonymizeIp: true,
})
```

The hostname and path these return are the ones matched, answered on the check path, appended by
a catch-all and reported, so they always agree. Options that identify the request (`hostname`,
`path`) leave it alone on `null`: it goes straight to the origin, and the rules are not even loaded
for it. Options that are only reported (`clientIp`, `userAgent`) write `-` on `null`.

## Behaviour

Only **GET and HEAD** on a **hostname listed** in the rules are answered; everything else goes to
the origin unchanged.

1. **Check path** (`/_redirhub/check`): `200`, `text/plain`, `Cache-Control: no-store`, body
   `token=<check token> etag=<ETag of the rules in use>`. It proves the hostname is yours and
   tells RedirHub which rules you serve.
2. **Exact rules** redirect before the origin, even when the page exists.
3. Otherwise the origin answers. Only when it answers **404** and the hostname has a **catch-all
   rule** (`{host}/*`), the 404 is discarded and the Worker redirects instead; a working page is
   never taken over. Without a catch-all, the 404 goes to the visitor and is reported when the
   hostname has **Report 404 pages** on.

Matching follows format v1: the hostname in any case, port ignored; the path case-sensitive,
percent-decoded, leading and trailing slashes ignored; scheme and query ignored. Every redirect
carries `X-Powered-By` when the rules file has `@powered-by`.

**Rules download.** The first request of a new isolate starts the download and waits for it at
most one second; if the rules server is slower, that request goes to the origin without rules and
the download (5 second timeout) finishes in `ctx.waitUntil`. Requests that arrive meanwhile do not
wait. After that the copy in memory is used, and once it is older than `@refresh` seconds (60 by
default) it is revalidated in `ctx.waitUntil` with `If-None-Match`, so no visitor waits. Any
failure keeps the last good copy and waits 30 seconds before trying again. `@notify` (push) is
ignored: a Worker keeps no connection open.

**Reports.** A line queued while nothing is being sent goes out at once; lines queued while a
request is out go together in the next one (at most 100 lines or 64 KB, gzip with
`CompressionStream`, 2 second timeout). Only the request that starts sending waits for it, in
`ctx.waitUntil`, for at most 10 seconds; the others only add their line, so no request waits on
another's work. A failed or rejected batch is dropped, never retried; beyond 10,000 waiting lines,
lines are dropped.

## Privacy

Each report is one Apache combined line with the absolute URL:

```
203.0.113.9 - - [31/Oct/2026:19:10:00 +0000] "GET https://shop.example.com/old-pricing?utm=x HTTP/1.1" 301 0 "https://www.google.com/" "Mozilla/5.0 …" file=shop.example.com/old-pricing destination=https://shop.example.com/pricing
```

That is the visitor's IP address (`CF-Connecting-IP`, or anonymized with `anonymizeIp`), the time
(UTC), the method, the requested URL with its query string, the status, the response size, the
Referer and the User-Agent (each cut to 1 KB); for a redirect also the rule's source and the
`Location` sent. The protocol is always written `HTTP/1.1`. No cookies, other headers or bodies
are sent. Only redirects, and 404s of hostnames with 404 reporting on, are reported; all other
traffic stays between the visitor and your origin. Reports go only to the `@hits` address of your
rules file, with your key.

## Limits

- The rules live in each isolate's memory: a new isolate waits up to one second for them, and
  serves no redirects until they arrive.
- Changes are live within `@refresh` seconds per isolate (60 by default).
- The rules file is at most 32 MB, and must fit the Worker's memory.

## Development

Node.js 22.18 or later runs the TypeScript tests directly.

```sh
npm install
npm run typecheck
npm test
npm run build
npm run check:spec   # spec/v1 is still the same as redirhub/integration-spec's
npm run check:core   # src/core and test/core are the same as redirhub/nextjs-redirects'
```

`src/core/` (the format: parsing, matching, downloading, reporting) and its tests in `test/core/`
are shared, file for file, with [nextjs-redirects](https://github.com/redirhub/nextjs-redirects).
Change both repositories together; CI flags a difference. `src/index.ts` is the Workers part.

## Releasing

Bump `version` in `package.json` and `VERSION` in `src/version.ts` (a test checks they match) and
merge to `main`. The Release workflow sees a version without a tag, runs the checks, publishes to
npm through Trusted Publishing (with provenance, no npm token stored anywhere), then tags the
commit `v<version>` and creates the GitHub Release. Nobody pushes a tag by hand; a push without a
version change releases nothing.

## License

Apache License 2.0, see [LICENSE](LICENSE). Copyright 2026 RedirHub.
