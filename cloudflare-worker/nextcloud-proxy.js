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

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        try {
            // Extract target Nextcloud URL from query parameter
            const url = new URL(request.url);
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
