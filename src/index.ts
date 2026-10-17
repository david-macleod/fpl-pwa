/**
 * fpl.macleod.in — one Worker serving the static PWA and proxying the FPL API.
 *
 * The FPL API sends no CORS headers, which is why the browser could never call it
 * directly and why this app leaned on third-party CORS proxies — and kept breaking
 * when they rate-limited, 403'd or went down. Server-side there is no such rule:
 * this Worker fetches fantasy.premierleague.com itself and serves the result from
 * the same origin as the page, so the browser never makes a cross-origin request
 * and there is no third party left to be flaky.
 *
 * Layout mirrors worldcup-2026-draft: run_worker_first sends every request here,
 * /api/* is handled below, everything else is delegated to the ASSETS binding.
 */

interface Env {
  ASSETS: Fetcher
}

const FPL_API = 'https://fantasy.premierleague.com/api'
const API_PREFIX = '/api/fpl/'

/**
 * How long the edge may reuse a response, per endpoint. Live endpoints stay short
 * so scores keep moving; bootstrap-static is ~1.5MB and changes rarely, so it gets
 * the long end. This also stops eight parallel team fetches from hammering FPL.
 */
const CACHE_TTLS: Array<[RegExp, number]> = [
  [/^bootstrap-static\//, 300],
  [/^event\/\d+\/live\//, 30],
  [/^fixtures\//, 30],
  [/^entry\/\d+\/event\/\d+\/picks\//, 60],
  [/^leagues-h2h-matches\//, 60],
  [/^leagues-(h2h|classic)\//, 60],
]

function ttlFor(path: string): number {
  for (const [pattern, ttl] of CACHE_TTLS) {
    if (pattern.test(path)) return ttl
  }
  return 60
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function proxyFpl(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice(API_PREFIX.length)

  // The upstream host is fixed, so this is not an open proxy. Reject traversal
  // anyway so a crafted path cannot climb out of /api/ on fantasy.premierleague.com.
  if (path.includes('..')) {
    return json({ error: 'Invalid path' }, 400)
  }

  const upstream = new URL(`${FPL_API}/${path}`)
  upstream.search = url.search

  const cache = caches.default
  const cacheKey = new Request(upstream.toString(), { method: 'GET' })

  const hit = await cache.match(cacheKey)
  if (hit) {
    const res = new Response(hit.body, hit)
    res.headers.set('x-fpl-cache', 'hit')
    return res
  }

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstream.toString(), {
      headers: {
        // Descriptive and honest. If FPL ever starts 403'ing this, that is the
        // first thing to look at — check `wrangler tail` for the status.
        'user-agent': 'fpl.macleod.in (personal H2H tracker)',
        accept: 'application/json',
      },
      // Give up rather than hang the page behind a slow upstream.
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    return json({ error: `Upstream fetch failed: ${(err as Error).message}` }, 502)
  }

  // Pass failures straight through (a wrong league id is a real 404) and never
  // cache them, so a transient upstream blip does not stick around for minutes.
  if (!upstreamRes.ok) {
    return json(
      { error: `FPL API returned ${upstreamRes.status}`, path },
      upstreamRes.status === 404 ? 404 : 502,
    )
  }

  const ttl = ttlFor(path)
  const res = new Response(upstreamRes.body, upstreamRes)
  res.headers.set('cache-control', `public, max-age=${ttl}`)
  res.headers.set('x-fpl-cache', 'miss')
  res.headers.delete('set-cookie')

  ctx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true })
    }

    if (url.pathname.startsWith(API_PREFIX)) {
      if (request.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405)
      }
      return proxyFpl(request, ctx)
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404)
    }

    // Everything else → the static PWA in ./public
    return env.ASSETS.fetch(request)
  },
}
