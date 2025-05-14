# Heroku Configuration and Deployment Guide for SvS Bot

This guide covers all required changes to deploy the SvS Bot to Heroku successfully.

## Required Project Changes for Heroku

To make the SvS Bot work on Heroku, the following files have been added or modified:

### 1. Procfile

Create a `Procfile` in the root directory with the following content:
```
web: node index.js
```

### 2. package.json Updates

Update your `package.json` file to include a start script:
```json
"scripts": {
  "test": "echo \"Error: no test specified\" && exit 1",
  "start": "node index.js"
}
```

### 3. HTTP Server for Binding to PORT

Update `index.js` to create a simple HTTP server that binds to Heroku's PORT environment variable:

```javascript
// Setup a basic HTTP server to satisfy Heroku
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SvS Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
```

### 4. Google Auth Helper

Create `fixGoogleAuth.js` to properly handle Google authentication on Heroku:

```javascript
// This file adds handling for properly formatting the Google service account private key
// on Heroku, which stores environment variables differently than local development

// If GOOGLE_PRIVATE_KEY has quotes, remove them (common Heroku issue)
if (process.env.GOOGLE_PRIVATE_KEY) {
  if (process.env.GOOGLE_PRIVATE_KEY.startsWith('"') && process.env.GOOGLE_PRIVATE_KEY.endsWith('"')) {
    process.env.GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.slice(1, -1);
  }
  
  // Replace literal \n with actual newlines if needed
  if (!process.env.GOOGLE_PRIVATE_KEY.includes('\n')) {
    process.env.GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
}

// Export helper function for cleaner authentication
module.exports = {
  getGoogleAuth: () => {
    const { google } = require('googleapis');
    return new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
  }
};
```

### 5. Update Command Files

Update all command files that use Google authentication to use the new auth helper:

```javascript
// Old authentication:
const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  )
});

// New authentication:
const { getGoogleAuth } = require('../fixGoogleAuth');
const sheets = google.sheets({
  version: 'v4',
  auth: getGoogleAuth()
});
```

## Environment Variables Setup

When deploying the SvS Bot to Heroku, you must correctly set the following environment variables:

### Required Environment Variables

1. **BOT_TOKEN** - Your Discord bot token
2. **CLIENT_ID** - Your Discord application client ID
3. **SPREADSHEET_ID** - Your Google Spreadsheet ID
4. **GOOGLE_CLIENT_EMAIL** - Service account email from Google Cloud
5. **GOOGLE_PRIVATE_KEY** - Service account private key from Google Cloud

### Setting Up Redis (If Used)

If your bot uses Redis for cooldowns or other features:

- **REDIS_HOST** - Redis server hostname
- **REDIS_PORT** - Redis server port (typically 6379)
- **REDIS_PASSWORD** - Redis server password

On Heroku, you may need to use the Redis Cloud add-on and configure your `redis-client.js` to use `REDISCLOUD_URL` instead.

### Setting Up Google Authentication (CRITICAL)

⚠️ **The GOOGLE_PRIVATE_KEY requires special handling on Heroku!**

When setting GOOGLE_PRIVATE_KEY:

1. **DO NOT INCLUDE QUOTES** around the value in Heroku's config vars UI
2. **PASTE THE ENTIRE KEY** including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
3. **KEEP THE NEWLINES** - Don't replace them with `\n` or any other character

## Step-by-Step Heroku Setup

1. **Login to Heroku Dashboard**: https://dashboard.heroku.com/

2. **Select your app** and go to the **Settings** tab

3. **Click "Reveal Config Vars"**

4. **Add the following config vars**:

   - `BOT_TOKEN` = your Discord bot token
   - `CLIENT_ID` = your Discord app client ID
   - `SPREADSHEET_ID` = your Google Sheet ID
   - `GOOGLE_CLIENT_EMAIL` = service account email from Google Cloud
   
5. **For GOOGLE_PRIVATE_KEY**:
   
   - Open your service account JSON file locally
   - Copy the entire `private_key` value (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`)
   - In Heroku, set `GOOGLE_PRIVATE_KEY` to this value WITHOUT quotes
   - Heroku will automatically handle newlines
   
6. **Set Up Redis (if needed)**:
   
   - Add the Redis Cloud add-on: `heroku addons:create rediscloud:30`
   - Heroku will automatically set `REDISCLOUD_URL`

## Deployment Process

1. **Ensure you have the Heroku CLI installed**:
   ```bash
   npm install -g heroku
   ```

2. **Login to Heroku from CLI**:
   ```bash
   heroku login
   ```

3. **Initialize Git repository if needed**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

4. **Create Heroku app (if new)**:
   ```bash
   heroku create your-app-name
   ```

5. **Push to Heroku**:
   ```bash
   git push heroku main
   ```

## Troubleshooting

### Google Authentication Issues

If you see this error: `error:1E08010C:DECODER routines::unsupported`, it means the private key is not formatted correctly.

Try these fixes:

1. Make sure you're setting the variable without surrounding quotes in Heroku
2. Set the private key directly from your Google service account JSON without any modifications
3. Check Heroku logs for specific error messages about the key format

### Port Binding Issues

If you see this error: `Error R10 (Boot timeout) -> Web process failed to bind to $PORT within 60 seconds of launch`:

1. Verify that your `index.js` includes the HTTP server code shown above
2. Ensure your Procfile is set up correctly
3. Check that you're not using any conflicting port bindings

### Redis Connection Issues

If you're having trouble connecting to Redis:

1. Verify the Redis add-on is properly installed
2. Check if your `redis-client.js` is configured to use `REDISCLOUD_URL`
3. See Heroku logs for specific Redis connection errors

## Testing the Deployment

After deployment, use one or two updated commands to test.

## Further Resources

- [Heroku Node.js Documentation](https://devcenter.heroku.com/categories/nodejs-support)
- [Google Cloud Service Accounts](https://cloud.google.com/iam/docs/service-accounts)
- [Heroku Redis Documentation](https://devcenter.heroku.com/articles/heroku-redis)