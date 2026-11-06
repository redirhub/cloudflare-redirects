/**
 * Cloudflare Workers: a Worker on the hostname's route in front of the origin. It answers the
 * check path and exact rules, passes everything else to the origin, and where the origin answers
 * 404 redirects to the catch-all or reports the 404.
 */

import { createRedirects, type Redirects, type RedirectsOptions, type WaitUntil } from './core/redirects.ts'

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
        instance = { id, redirects: createRedirects({ clientIp: cloudflareClientIp, ...rest, rulesUrl, key }) }
      }
      return instance.redirects.serve(request, (next) => origin(next, env, context), context)
    },
  }
}

/** `CF-Connecting-IP`, which Cloudflare sets. */
export function cloudflareClientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip')
}

export { anonymize, createRedirects, type Redirects, type RedirectsOptions, type WaitUntil } from './core/redirects.ts'
export type { Logger } from './core/log.ts'
export { hitLine, type Hit, type KeepAlive, Reporter, type ReporterOptions } from './core/report.ts'
export {
  buildLocation,
  DEFAULT_CHECK_PATH,
  FORMAT_MAJOR,
  type HostRules,
  matchExact,
  matchPath,
  normalizeHost,
  parseRules,
  type RedirectStatus,
  type Rule,
  type RuleSet,
  UnknownFormatError,
} from './core/rules.ts'
export { RulesSource, type RulesSourceOptions } from './core/source.ts'
export { PACKAGE, USER_AGENT, VERSION } from './version.ts'
