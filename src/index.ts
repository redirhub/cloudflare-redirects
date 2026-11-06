/**
 * Cloudflare Workers: a Worker on the hostname's route in front of the origin. It answers the
 * check path and exact rules, passes everything else to the origin, and where the origin answers
 * 404 redirects to the catch-all or reports the 404.
 */

import { createRedirects as create, type Redirects, type RedirectsOptions, type WaitUntil } from './core/redirects.ts'

export type { Logger } from './core/log.ts'
export type { Redirects, RedirectsOptions, WaitUntil }

export interface WorkerSettings {
  rulesUrl: string | null | undefined
  key?: string | null
}

export interface WorkerOptions<Env> extends Omit<RedirectsOptions, 'rulesUrl' | 'key'> {
  /** Reads the rules address and the key from the Worker's bindings. */
  settings: (env: Env) => WorkerSettings
  /** Where requests that no rule answers go; default the origin, `fetch(request)`. */
  origin?: (request: Request, env: Env, context: WaitUntil) => Promise<Response>
}

/**
 * A module Worker:
 *
 * ```ts
 * export default createWorker({
 *   settings: (env) => ({ rulesUrl: env.ACME_RULES_URL, key: env.ACME_INTEGRATION_KEY }),
 * })
 * ```
 */
export function createWorker<Env>(options: WorkerOptions<Env>): { fetch(request: Request, env: Env, context: WaitUntil): Promise<Response> } {
  const { settings, origin = (request: Request) => fetch(request), ...rest } = options
  // Bindings arrive with each request; one instance per isolate and settings.
  let instance: { id: string; redirects: Redirects } | null = null

  return {
    async fetch(request, env, context) {
      const { rulesUrl, key } = settings(env)
      const id = `${rulesUrl ?? ''}\0${key ?? ''}`
      if (instance?.id !== id) {
        instance = { id, redirects: createRedirects({ ...rest, rulesUrl, key }) }
      }
      return instance.redirects.serve(request, (next) => origin(next, env, context), context)
    },
  }
}

/**
 * The integration in two steps, for a Worker with its own routing: `handle` before the origin,
 * `afterSite` after it, or `serve` for both. The visitor's address defaults to `CF-Connecting-IP`.
 */
export function createRedirects(options: RedirectsOptions): Redirects {
  return create({ ...options, clientIp: options.clientIp ?? cloudflareClientIp })
}

/** `CF-Connecting-IP`, which Cloudflare sets. */
function cloudflareClientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip')
}
