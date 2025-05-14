# SvS Bot Heroku Deployment Guide

This guide covers step-by-step instructions for deploying the SvS Discord bot to Heroku.

## Prerequisites

1. Heroku account (sign up at [heroku.com](https://heroku.com) if you don't have one)
2. Heroku CLI installed (install with `npm install -g heroku` or follow [Heroku CLI installation guide](https://devcenter.heroku.com/articles/heroku-cli))
3. Git installed on your local machine
4. Google Cloud service account with access to your Google Sheet
5. Your Discord bot token and client ID

## Step 1: Login to Heroku

Open your terminal and login to Heroku:

```bash
heroku login
```

## Step 2: Create a new Heroku app

Create a new Heroku application:

```bash
# If you want to specify a name
heroku create svs-bot

# Or let Heroku generate a name for you
heroku create
```

## Step 3: Set up Redis on Heroku

Add the Redis Cloud add-on to your Heroku app:

```bash
heroku addons:create rediscloud:30 --app YOUR_APP_NAME
```

This will automatically create a `REDISCLOUD_URL` environment variable that the bot will use.

## Step 4: Configure Environment Variables

Set up all required environment variables for the bot:

```bash
# Discord credentials
heroku config:set BOT_TOKEN="your_discord_bot_token" --app YOUR_APP_NAME
heroku config:set CLIENT_ID="your_discord_client_id" --app YOUR_APP_NAME

# Google Sheets credentials
heroku config:set SPREADSHEET_ID="your_google_spreadsheet_id" --app YOUR_APP_NAME
heroku config:set GOOGLE_CLIENT_EMAIL="your_service_account_email" --app YOUR_APP_NAME
```

## Step 5: Set up Google Private Key (IMPORTANT)

For the Google private key, follow these special instructions:

1. Open your Google service account JSON file
2. Copy the entire `private_key` value (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`)
3. Set it as an environment variable **WITHOUT QUOTES** around it:

```bash
heroku config:set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFA...
...
...lines of key...
...
...K/Y=
-----END PRIVATE KEY-----" --app YOUR_APP_NAME
```

## Step 6: Deploy the Bot

Push your code to Heroku:

```bash
# If this is your first time setting up the remote
git remote add heroku https://git.heroku.com/YOUR_APP_NAME.git

# Push the code to Heroku
git push heroku main
```

## Step 7: Scale the Dyno

By default, Heroku may not start your web dyno. Ensure it's running:

```bash
heroku ps:scale web=1 --app YOUR_APP_NAME
```

## Step 8: Check Logs

You can check the logs to make sure everything is running correctly:

```bash
heroku logs --tail --app YOUR_APP_NAME
```

## Troubleshooting

### Redis Connection Issues

If the bot fails to connect to Redis:

1. Verify the Redis Cloud add-on is installed:
   ```bash
   heroku addons --app YOUR_APP_NAME
   ```

2. Check that `REDISCLOUD_URL` is properly set:
   ```bash
   heroku config --app YOUR_APP_NAME | grep REDIS
   ```

### Google Authentication Issues

If the bot fails to authenticate with Google:

1. Make sure `GOOGLE_PRIVATE_KEY` is set correctly without surrounding quotes in Heroku's config
2. Check that `GOOGLE_CLIENT_EMAIL` is the complete service account email
3. Verify that your service account has access to the specified spreadsheet

### Port Binding Issues

If you see an error like `Error R10 (Boot timeout) -> Web process failed to bind to $PORT within 60 seconds of launch`:

1. Make sure the HTTP server in `index.js` is properly set up
2. Check the Procfile is correctly configured with `web: node index.js`

## Maintenance

### Updating the Bot

When you make changes to the bot:

1. Commit your changes to your local Git repository
2. Push to Heroku:
   ```bash
   git push heroku main
   ```

### Restarting the Bot

If you need to restart the bot:

```bash
heroku restart --app YOUR_APP_NAME
```

### Viewing Logs

To view the application logs:

```bash
heroku logs --tail --app YOUR_APP_NAME
```

## Additional Resources

- [Heroku Node.js Documentation](https://devcenter.heroku.com/categories/nodejs-support)
- [Heroku Redis Documentation](https://devcenter.heroku.com/articles/heroku-redis)
- [Google Cloud Service Accounts](https://cloud.google.com/iam/docs/service-accounts)