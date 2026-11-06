# cloudflare-redirects

**Bulk redirects and 404 monitoring for [Cloudflare Workers](https://workers.cloudflare.com), from
a remote rules file.** A Worker in front of your origin serves thousands of redirects from a rules
file and reports every redirect and every 404 back, so broken links show up before your visitors
find them.

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
| `clientIp(request)` | The visitor's address; default `CF-Connecting-IP`. |
| `anonymizeIp` | Report IPv4 with the last byte zeroed, IPv6 cut to /48. |
| `logger` | Default `console`; `null` for silence. Failures are logged at most once per ten minutes. |

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

**Rules download.** The first request of an isolate downloads the file (5 second timeout) and
waits for it; after that the copy in memory is used, and once it is older than `@refresh` seconds
(60 by default) it is revalidated in `ctx.waitUntil` with `If-None-Match`, so no visitor waits.
Any failure keeps the last good copy and waits 30 seconds before trying again. `@notify` (push) is
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

- The rules live in each isolate's memory: a new isolate waits for one download.
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

## License

Apache License 2.0, see [LICENSE](LICENSE). Copyright 2026 RedirHub.
