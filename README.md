# SvS-Bot-2

SvS-Bot-2 is a Discord bot designed to manage and display a Player vs. Player (PvP) leaderboard for the SvS Ladder. It integrates with Google Sheets to maintain the leaderboard data and provides commands to manage challenges and report match results.

## Table of Contents
- [Features](#features)
- [Setup Instructions](#setup-instructions)
- [Commands](#commands)
  - [/leaderboard](#leaderboard)
  - [/challenge](#challenge)
  - [/reportwin](#reportwin)
  - [/nullchallenge](#nullchallenge)
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
