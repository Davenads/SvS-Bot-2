Here's the README with comprehensive details about your SvS-Bot-2:

```markdown
# SvS-Bot-2

SvS-Bot-2 is a Discord bot designed to manage and display a Player vs. Player (PvP) leaderboard for the SvS Ladder. It integrates with Google Sheets to maintain the leaderboard data and provides commands to manage challenges and report match results.

## Table of Contents
- [Features](#features)
- [Setup Instructions](#setup-instructions)
- [Commands](#commands)
  - [/leaderboard](#leaderboard-command)
  - [/challenge](#challenge-command)
  - [/reportwin](#reportwin-command)
  - [/nullchallenge](#nullchallenge-command)
- [Troubleshooting](#troubleshooting)

## Features
- Display an up-to-date PvP leaderboard using data stored in a Google Sheet.
- Allow players to issue challenges to other players within the SvS ladder.
- Track match results and automatically update the leaderboard.
- Manage player statuses (e.g., Available, Challenge, Vacation).

## Setup Instructions

### Prerequisites
- Node.js and npm installed on your machine.
- A Discord bot with the necessary permissions added to your server.
- A Google Sheet set up with the required columns for tracking leaderboard data.

### 1. Clone the Repository
```bash
git clone <repository-url>
cd SvS-Bot-2
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
- Create a `.env` file in the root directory and add your credentials:
  ```
  DISCORD_TOKEN=your-discord-bot-token
  SPREADSHEET_ID=your-google-sheet-id
  CLIENT_EMAIL=your-service-account-email
  PRIVATE_KEY="your-private-key"
  ```
- Replace with your actual Discord bot token, Google Sheet ID, and Google Service Account credentials.

### 4. Deploy Commands to Discord
```bash
node deploy-commands.js
```

### 5. Start the Bot
```bash
node index.js
```

## Commands

### /leaderboard Command
Displays the current PvP leaderboard, showing each player's rank, spec (Vita or ES), and element (Fire, Light, Cold).
- Usage: `/leaderboard`
- Allows pagination for viewing the full list of players.

### /challenge Command
Allows a player to challenge another player ranked above them within the allowed range.
- Usage: `/challenge <target_rank>`
- The player can challenge others within 4 ranks above their current position. Players in the top 10 may challenge up to 3 ranks ahead.

### /reportwin Command
Reports the results of a completed challenge, swapping the challenger and challenged player positions if the challenger wins.
- Usage: `/reportwin <challenger_rank> <challenged_rank>`
- Automatically updates player statuses and clears challenge information.

### /nullchallenge Command
Cancels an ongoing challenge, reverting the players' statuses to 'Available.'
- Usage: `/nullchallenge <challenger_rank> <challenged_rank>`
- Only available to users with the `@SvS Manager` role or the initiating user.

## Troubleshooting
- **Bot Doesn't Respond:** Ensure the bot is running (`node index.js`) and that it has the necessary permissions in your Discord server.
- **Google Sheets Integration Issues:** Verify that your `.env` file contains the correct `SPREADSHEET_ID`, `CLIENT_EMAIL`, and `PRIVATE_KEY`.
- **Command Errors:** Make sure you've deployed the latest commands using `node deploy-commands.js`.
```

### Notes:
- Make sure to replace `<repository-url>` with the actual URL of your GitHub repository.
- If you wish to customize any sections, feel free to adjust the text accordingly.

This README should be clear and detailed enough to provide a comprehensive overview of your SvS-Bot-2 bot, its features, setup instructions, and command functionalities.