# SvS-Bot-2

A Discord bot for managing an SvS leaderboard using Google Sheets as a database. Features rank challenges, status updates, and modular command handling.

## Features

- **Leaderboard Management**: Track player ranks, specs (Vita or ES), elements (Fire, Light, Cold), and challenge statuses.
- **Challenge System**: Initiate challenges between players and update the leaderboard based on challenge results.

## Slash Commands

### `/leaderboard`

Displays the full SvS leaderboard with player rankings, specs (Vita or ES), and elements (Fire, Light, Cold).  
Keep track of the current standings and see how players rank in the ladder.

### `/challenge`

Initiates a challenge between two players on the leaderboard.  
Provide the challenger’s rank and the target’s rank. The bot will update both players’ statuses and handle the challenge process.

### `/currentchallenges`

Lists all active challenges in the SvS Ladder.  
This command allows users to see who is currently in a challenge and keep track of ongoing matches.

### `/reportwin`

Reports the results of a challenge.  
Provide the ranks of the challenger and the challenged player, and the bot will automatically update the leaderboard based on the result.

### `/register`

Registers a new character to the ladder.  
Provide the character name, spec (Vita or ES), element (Fire, Light, or Cold), Discord username, and optional notes.  
This command requires the **@SvS Manager** role.

## Role Requirement

All commands require users to have the **@SvS Dueler** role to interact with the bot, except `/register` which requires the **@SvS Manager** role.

## Technology Stack

- **Discord.js**: For Discord interaction handling.
- **Google Sheets API**: For managing the SvS leaderboard data.

## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/Davenads/SvS-Bot-2.git
   cd SvS-Bot-2
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Set up your environment variables in a `.env` file:
   ```sh
   BOT_TOKEN=your-discord-bot-token
   GOOGLE_CLIENT_EMAIL=your-google-client-email
   GOOGLE_PRIVATE_KEY=your-google-private-key
   SHEET_ID=your-google-sheet-id
   ```

4. Run the bot:
   ```sh
   node index.js
   ```

## Dependencies

- `discord.js` ^14.16.3
- `dotenv` ^16.4.5
- `google-spreadsheet` ^4.1.4
- `googleapis` ^144.0.0
- `@google-cloud/local-auth` ^3.0.1

## License

This project is licensed under the MIT License.