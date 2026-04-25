# Developer Setup for Real Cloud Provider Testing

The GitHub Pages demo uses **mock pickers** because Google/Microsoft OAuth apps require verification to be publicly accessible. This guide shows how to test with **real cloud provider SDKs** locally.

## Why Mocks for Public Demo?

- **Google Drive**: OAuth apps in "Testing" mode only work for whitelisted users. "Production" mode requires [app verification](https://support.google.com/cloud/answer/9110914) (security assessment, privacy policy, weeks of review).
- **OneDrive**: Similar restrictions for unverified apps
- **Dropbox**: Requires app review for production use
- **BayernCloud**: Requires user credentials (password/token)

**For public demos**, mocks are the standard solution.

## Local Testing with Real SDKs

### Prerequisites
- Local web server (e.g., `npx serve`, `python -m http.server`, or VS Code Live Server)
- Developer accounts for each cloud provider

### 1. Google Drive Setup

**Create OAuth App:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., "TinyMCE MultiCloud Local")
3. Enable **"Google Picker API"**
4. Go to **APIs & Services → Credentials**:
   - **Create API Key**:
     - Application restrictions: HTTP referrers
     - Add: `http://localhost:*/*`
   - **Create OAuth 2.0 Client ID**:
     - Application type: Web application
     - Authorized JavaScript origins: `http://localhost:3000` (adjust port as needed)
5. Go to **OAuth consent screen**:
   - User Type: **External** (stays in Testing mode)
   - Add your email as a test user
6. Copy `clientId` and `apiKey`

**Update config:**
```javascript
googleDrive: {
  enabled: true,
  clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  apiKey: "YOUR_API_KEY"
  // NO pickerUrl = uses real SDK
}
```

### 2. OneDrive Setup

**Create Azure AD App:**
1. Go to [Azure Portal](https://portal.azure.com/) → Azure Active Directory → App registrations
2. **New registration**:
   - Name: "TinyMCE MultiCloud Local"
   - Supported account types: Personal Microsoft accounts only
   - Platform: **Single-page application (SPA)**
   - Redirect URI: `http://localhost:3000/demo/tinymce-demo.html` (adjust port)
3. Copy **Application (client) ID**

**Update config:**
```javascript
oneDrive: {
  enabled: true,
  clientId: "YOUR_CLIENT_ID"
}
```

### 3. Dropbox Setup

**Create Dropbox App:**
1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. **Create app**:
   - API: Scoped access
   - Access: Full Dropbox
   - Name: "TinyMCE MultiCloud Local"
3. **Settings**:
   - Chooser → Allowed domains: Add `localhost:3000` (adjust port)
4. Copy **App key**

**Update config:**
```javascript
dropbox: {
  enabled: true,
  appKey: "YOUR_APP_KEY"
}
```

### 4. BayernCloud/Nextcloud Setup

**Get credentials:**
1. Log in to your Nextcloud instance
2. Generate an app password (Settings → Security → Devices & sessions)

**Update config:**
```javascript
bayerncloud: {
  enabled: true,
  username: "your.email@example.com",
  password: "your-app-password",  // NOT your account password!
  baseUrl: "https://your-nextcloud-instance.com"
}
```

## Running Locally

### Option 1: Using npm scripts
```bash
npm start
# Opens http://localhost:3000
```

### Option 2: Using serve
```bash
npx serve -p 3000
# Navigate to http://localhost:3000/demo/tinymce-demo.html
```

### Option 3: VS Code Live Server
1. Install "Live Server" extension
2. Right-click `demo/tinymce-demo.html` → "Open with Live Server"

## Testing Configuration

Create a local `demo/multicloud.config.local.js` with your credentials (gitignored):

```javascript
window.MULTICLOUD_CONFIG = {
  providers: {
    googleDrive: {
      enabled: true,
      clientId: "123456789-abc.apps.googleusercontent.com",
      apiKey: "AIzaSy...your-key"
    },
    oneDrive: {
      enabled: true,
      clientId: "12345678-1234-1234-1234-123456789abc"
    },
    dropbox: {
      enabled: true,
      appKey: "abcdefghijklmno"
    },
    bayerncloud: {
      enabled: false  // Requires password, keep disabled for testing
    }
  },
  defaultProvider: "googleDrive"
};
```

Then update the demo HTML to load it:
```html
<script src="./multicloud.config.local.js"></script>
```

## Security Notes

- **Never commit real credentials** to the repository
- Local testing credentials should be restricted to `localhost` origins
- OAuth "Testing" mode is sufficient for local development
- Production deployment requires app verification from each provider

## Troubleshooting

**"OAuth access restricted to test users"**
- Normal for local testing. Add your Google account as a test user in OAuth consent screen.

**"Origin not allowed"**
- Check your OAuth app's authorized JavaScript origins match your local server URL exactly (including port).

**CORS errors**
- Ensure you're using a proper web server (not `file://` protocol).
- Check that API keys are restricted correctly.

**"Popup blocked"**
- Allow popups for localhost in your browser settings.
- The plugin shows a fallback dialog if popups are blocked.

## Need Help?

Open an issue at: https://github.com/CallariS/tinymce-multicloud-plugin/issues
