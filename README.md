# SvS-Bot-2

![SvS League Banner](./assets/SvS_D2RPvP1.png)

SvS-Bot-2 is a Discord bot for managing PvP duel leaderboards in the "SvS" community, using Google Sheets as its database and Redis for challenge tracking and cooldowns.

## Features

- **Leaderboard System**: View and challenge others on the leaderboard.
- **Game Management**: Register for events and report match outcomes.
- **Role-Based Commands**: Commands are restricted based on assigned roles.
- **Challenge Tracking**: Automatic challenge expiry system with notifications.
- **Cooldown System**: 24-hour cooldown periods between player matchups.
- **Auto-Nullification**: Redis-backed event-driven system to auto-null expired challenges.

## Prerequisites

- Node.js (latest LTS version)
- Google Cloud project with Google Sheets API access
- Discord bot token
- Redis server (for challenge tracking and cooldowns)

## Project Structure

```
SvS-Bot-2/
|-- commands/                 # Command files (challenge, leaderboard, etc.)
|-- config/                   # Google Sheets API credentials
|-- handlers/                 # Command handler logic
|-- assets/                   # Image assets
|-- .gitignore                # Ignoring sensitive/unnecessary files
|-- clear-commands.js         # Clear registered bot commands
|-- deploy-commands.js        # Deploy commands to Discord
|-- challenge-expiry-checker.js  # Redis challenge expiry timer
|-- challenge-expiry-handler.js  # Auto-null logic for expired challenges
|-- logger.js                 # Logging module
|-- redis-client.js           # Redis client for challenge and cooldown tracking 
|-- package.json              # Project dependencies and scripts
|-- README.md                 # Project documentation
```

## Setup

1. **Clone the Repository**
   ```sh
   git clone https://github.com/yourusername/SvS-Bot-2.git
   cd SvS-Bot-2
   ```
2. **Install Dependencies**
   ```sh
   npm install
   ```
3. **Environment Variables** Create a `.env` file in the root directory:
   ```
   DISCORD_TOKEN="your_discord_bot_token_here"
   GOOGLE_CLIENT_EMAIL="your_google_client_email_here"
   GOOGLE_PRIVATE_KEY="your_google_private_key_here"
   SHEET_ID="your_google_sheet_id_here"
   REDIS_HOST="your_redis_host"
   REDIS_PORT="your_redis_port"
   REDIS_PASSWORD="your_redis_password"
   ```
4. **Google Sheets API**
   - Obtain `credentials.json` from Google Cloud Console and place it in `config/`.
   - Share the Google Sheet with the client email.
5. **Redis Setup**
   - Ensure Redis is installed and configured with keyspace notifications enabled.
   - Set `notify-keyspace-events` to `Ex` for expiry events.

## Running the Bot

- **Start the Bot**
  ```sh
  node index.js
  ```
- **Deploy Commands**
  ```sh
  node deploy-commands.js
  ```

## Commands

### Player Commands
- `/challenge` - Initiate a challenge against another player.
- `/currentchallenges` - Display ongoing challenges.
- `/extendchallenge` - Request to extend the expiry time of a challenge.
- `/leaderboard` - Show the current leaderboard standings.
- `/register` - Register to the leaderboard as a new player.
- `/reportwin` - Report duel results.
- `/stats` - View player statistics.
- `/titledefends` - View title defense records.
- `/signup` - Sign up for a tournament or event.
- `/help` - Display command information.

### Moderator Commands
- `/cancelchallenge` - Cancel an active challenge (moderators only).
- `/nullchallenges` - Nullify challenges (moderators only).
- `/insert` - Insert a player into the leaderboard (moderators only).
- `/remove` - Remove a player from the leaderboard (moderators only).
- `/dodge` - Track player dodges (moderators only).
- `/cooldowndebug` - View or clear challenge cooldowns (moderators only).
- `/currentvacations` - View players on vacation status.
- `/extendedvacations` - View extended vacation status.

## Auto-Nullification System

The bot features an event-driven auto-nullification system for challenges:

- Challenges expire after 3 days if not completed.
- 24-hour warning notifications are sent before expiration.
- Expired challenges are automatically nullified.
- Challenge data is stored in Redis with TTL (Time To Live).
- Redis keyspace notifications trigger expiry events.

## Cooldown System

After a challenge is completed:

- A 24-hour cooldown is set between the two players.
- Players cannot challenge each other during the cooldown period.
- Cooldowns are stored in Redis with automatic expiration.
- Moderators can view and manage cooldowns with `/cooldowndebug`.

## Roles

- **@SvS Dueler** - Required for player commands.
- **@SvS Manager** - Required for moderator commands.

## Contribution

- Fork the repository, create a new branch, and submit a pull request.

## License

This project is licensed under the MIT License. See `LICENSE` for details.