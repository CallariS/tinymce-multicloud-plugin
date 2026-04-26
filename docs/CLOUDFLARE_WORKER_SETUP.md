# Cloudflare Worker Setup for Nextcloud/BayernCloud

This guide helps you deploy a CORS proxy to enable browser-based Nextcloud access.

## Why is this needed?

Nextcloud instances don't allow browser requests from different domains (CORS policy). The Cloudflare Worker acts as a proxy that adds CORS headers, enabling the picker to work from GitHub Pages or any web deployment.

## Free Tier

Cloudflare Workers free tier includes:
- ✅ 100,000 requests/day
- ✅ Global edge network
- ✅ No credit card required

## Setup Steps

### 1. Create Cloudflare Account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up for a free account
3. Verify your email

### 2. Create Worker

1. Go to https://dash.cloudflare.com/
2. Click **Workers & Pages** in the left sidebar
3. Click **Create Application**
4. Click **Create Worker**
5. Give it a name like `nextcloud-proxy`
6. Click **Deploy**

### 3. Edit Worker Code

1. After deployment, click **Edit Code**
2. Delete the default code
3. Copy the entire contents of `cloudflare-worker/nextcloud-proxy.js`
4. Paste into the editor
5. Click **Save and Deploy**

### 4. Get Worker URL

Your worker URL will be something like:
```
https://nextcloud-proxy.your-account.workers.dev
```

Copy this URL - you'll need it for configuration.

### 5. Update Plugin Configuration

Option A: Update the demo config (`demo/multicloud.config.js`):

```javascript
bayerncloud: {
    enabled: true,
    pickerUrl: "./pickers/bayerncloud.html",
    proxyUrl: "https://nextcloud-proxy.your-account.workers.dev"
}
```

Option B: Update the picker directly (`demo/pickers/bayerncloud.html`):

Find the line:
```javascript
const PROXY_URL = null; // Set your Cloudflare Worker URL
```

Change to:
```javascript
const PROXY_URL = "https://nextcloud-proxy.your-account.workers.dev";
```

### 6. Test

1. Deploy your changes to GitHub Pages
2. Open the demo
3. Click the BayernCloud/Nextcloud button
4. Enter a Nextcloud server URL (e.g., `https://fie.nl.tab.digital`)
5. Authorize in the popup
6. Browse files - CORS should now work! 🎉

## Security Notes

The worker:
- ✅ Only allows HTTPS targets (no HTTP)
- ✅ Only allows your GitHub Pages origin (+ localhost for dev)
- ✅ Validates URLs before proxying
- ✅ Passes through authentication headers securely
- ⚠️ Anyone with your worker URL can proxy requests (consider rate limiting for production)

## Custom Domain (Optional)

You can add a custom domain to your worker:
1. In Worker settings, click **Triggers**
2. Click **Add Custom Domain**
3. Follow the DNS setup instructions

## Monitoring

View usage statistics:
1. Go to your Worker in the dashboard
2. Click **Metrics**
3. See request counts, errors, and performance

## Troubleshooting

**Worker not receiving requests:**
- Check the worker URL is correct in config
- Verify worker is deployed (status should be "Active")

**CORS errors still occurring:**
- Make sure your GitHub Pages URL is in the `allowedOrigins` array
- Check browser console for the exact origin being used

**403/401 errors:**
- The worker is working, but Nextcloud authentication failed
- Check username/password or app token

## Cost

Free tier limits:
- 100,000 requests/day
- 10ms CPU time per request
- Plenty for personal/demo usage!

Paid tier ($5/month):
- 10 million requests/month
- 30s CPU time per request
- Only needed for high-traffic production use

## Alternative: Vercel

If you prefer Vercel, see `docs/VERCEL_PROXY.md` for setup instructions.
