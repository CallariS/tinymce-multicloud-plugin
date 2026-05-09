/**
 * Cloudflare Worker - Nextcloud CORS Proxy
 * 
 * This worker proxies requests to Nextcloud instances to bypass CORS restrictions.
 * Deploy this to Cloudflare Workers to enable browser-based Nextcloud access.
 * 
 * Setup:
 * 1. Create a Cloudflare account (free tier works)
 * 2. Go to Workers & Pages
 * 3. Create a new Worker
 * 4. Paste this code
 * 5. Deploy
 * 6. Note the worker URL (e.g., https://nextcloud-proxy.your-account.workers.dev)
 * 7. Update picker to use this URL
 */

// ---------------------------------------------------------------------------
// In-memory rate limiter — 60 requests per minute per client IP.
// Uses a sliding-window counter stored in a module-level Map. The Map is
// per-Worker-isolate (not globally shared across all edge nodes), so this is
// best-effort rather than globally consistent — but it reliably prevents
// burst abuse from a single browser session, which is the primary concern
// for a CORS proxy. No Cloudflare bindings or dashboard setup required.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const _rateLimitMap = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const entry = _rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        _rateLimitMap.set(ip, { count: 1, windowStart: now });
        return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Health check endpoint — used by monitoring workflows
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
            });
        }

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        // Per-IP rate limiting (in-memory, per-isolate — see top of file)
        const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        if (!checkRateLimit(clientIp)) {
            return new Response('Rate limit exceeded — try again in a moment', {
                status: 429,
                headers: { 'Retry-After': '60', ...corsHeaders(request) }
            });
        }

        try {
            // Extract target Nextcloud URL from query parameter
            const targetUrl = url.searchParams.get('target');

            if (!targetUrl) {
                return new Response('Missing "target" query parameter', {
                    status: 400,
                    headers: corsHeaders(request)
                });
            }

            // Validate target URL (basic security check)
            let targetURL;
            try {
                targetURL = new URL(targetUrl);
            } catch {
                return new Response('Invalid target URL', {
                    status: 400,
                    headers: corsHeaders(request)
                });
            }

            // Only allow HTTPS (security)
            if (targetURL.protocol !== 'https:') {
                return new Response('Only HTTPS targets allowed', {
                    status: 400,
                    headers: corsHeaders(request)
                });
            }

            // Enforce target host allowlist when ALLOWED_TARGET_HOSTS env var is set.
            // Set it in the Cloudflare dashboard or wrangler.toml [vars] as a
            // comma-separated list of hostnames, e.g. "nextcloud.example.com,cloud.example.org".
            // When unset (empty / undefined) any HTTPS host is allowed — suitable for
            // personal/demo use; restrict for production deployments.
            const allowedHosts = (env.ALLOWED_TARGET_HOSTS ?? '')
                .split(',')
                .map(h => h.trim())
                .filter(Boolean);
            if (allowedHosts.length > 0 && !allowedHosts.includes(targetURL.hostname)) {
                return new Response('Target host not in allowlist', {
                    status: 403,
                    headers: corsHeaders(request)
                });
            }

            // Clone the request and forward to target
            const modifiedRequest = new Request(targetUrl, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: 'follow'
            });

            // Remove problematic headers that might cause issues
            modifiedRequest.headers.delete('origin');
            modifiedRequest.headers.delete('referer');

            // Make the request to Nextcloud
            const response = await fetch(modifiedRequest);

            // Clone response and add CORS headers
            const modifiedResponse = new Response(response.body, response);

            // Add CORS headers
            const headers = corsHeaders(request);
            Object.entries(headers).forEach(([key, value]) => {
                modifiedResponse.headers.set(key, value);
            });

            return modifiedResponse;

        } catch (error) {
            return new Response(`Proxy error: ${error.message}`, {
                status: 502,
                headers: corsHeaders(request)
            });
        }
    }
};

/**
 * Get CORS headers for response
 */
function corsHeaders(request) {
    const origin = request.headers.get('Origin');

    // Allow specific origins (add your GitHub Pages URL)
    const allowedOrigins = [
        'https://callaris.github.io',
        'https://waxcode.net',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080'
    ];

    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, X-Requested-With, OCS-APIRequest',
        'Access-Control-Max-Age': '86400',
    };

    // Check if origin is allowed
    if (origin && allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
    } else if (origin && origin.startsWith('http://localhost:')) {
        // Allow any localhost port for development
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return headers;
}

/**
 * Handle OPTIONS preflight request
 */
function handleOptions(request) {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
    });
}
