// services/removalService.js
//
// Shared ladder-removal core used by BOTH the /remove slash command and the
// #register "Leave Ladder" button. It deletes a character's row, re-ranks
// everyone below, fixes up opponent references / spanning challenge pairs, and
// cleans up any Redis challenge timer — identical to the original /remove flow.
//
// The caller owns all user-facing messaging (farewell embed, ephemeral reply);
// this function only mutates the sheet + Redis, refreshes the live boards, and
// returns the removed player's details.

require('dotenv').config();
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const redisClient = require('../redis-client');
const { logError } = require('../logger');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Remove the character at `rankToRemove` from `ladder`. Returns:
//   { success: true, player, ranksAreCorrect }
//   { success: false, reason }
async function removeCharacterByRank(client, ladder, rankToRemove) {
  const mainResult = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`,
  });

  const rows = mainResult.data.values;
  if (!rows || !rows.length) {
    return { success: false, reason: 'No data available on the leaderboard.' };
  }

  const rowIndex = rows.findIndex(row => row[0] && parseInt(row[0]) === rankToRemove);
  if (rowIndex === -1) {
    return { success: false, reason: 'Rank not found in the ladder.' };
  }

  const playerData = rows[rowIndex];
  const player = {
    name: playerData[1],
    spec: playerData[2],
    element: playerData[3],
    discordUsername: playerData[4],
    discordId: playerData[8],
    rank: rankToRemove,
  };

  const requests = [];

  // Fix up challenge pairs that span across the removed rank (the player above
  // needs their opponent's about-to-shift rank decremented).
  for (let i = 0; i < rows.length; i++) {
    const currentRow = rows[i];
    if (!currentRow[0] || !currentRow[7]) continue;

    const currentRank = parseInt(currentRow[0]);
    const oppRank = parseInt(currentRow[7]);

    if (
      currentRow[5] === 'Challenge' &&
      ((currentRank < rankToRemove && oppRank > rankToRemove) ||
        (currentRank > rankToRemove && oppRank < rankToRemove))
    ) {
      if (currentRank < rankToRemove) {
        requests.push({
          updateCells: {
            range: {
              sheetId: ladder.sheetId,
              startRowIndex: i + 1,
              endRowIndex: i + 2,
              startColumnIndex: 7,
              endColumnIndex: 8,
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: (oppRank - 1).toString() },
                    userEnteredFormat: { horizontalAlignment: 'RIGHT' },
                  },
                ],
              },
            ],
            fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment',
          },
        });
      }
    }
  }

  // If the removed player was in a challenge, free their opponent + clear Redis.
  if (playerData[5] === 'Challenge' && playerData[7]) {
    const opponentRank = parseInt(playerData[7]);
    const opponentIndex = rows.findIndex(row => row[0] && parseInt(row[0]) === opponentRank);

    if (opponentIndex !== -1) {
      try {
        const player1 = { discordId: playerData[8], element: playerData[3] };
        const player2 = { discordId: rows[opponentIndex][8], element: rows[opponentIndex][3] };
        await redisClient.removeChallenge(player1, player2, ladder);
      } catch (error) {
        logError('removalService: Redis challenge cleanup failed', error);
      }

      requests.push({
        updateCells: {
          range: {
            sheetId: ladder.sheetId,
            startRowIndex: opponentIndex + 1,
            endRowIndex: opponentIndex + 2,
            startColumnIndex: 5,
            endColumnIndex: 8,
          },
          rows: [
            {
              values: [
                { userEnteredValue: { stringValue: 'Available' } },
                { userEnteredValue: { stringValue: '' } },
                {
                  userEnteredValue: { stringValue: '' },
                  userEnteredFormat: { horizontalAlignment: 'RIGHT' },
                },
              ],
            },
          ],
          fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment',
        },
      });
    }
  }

  // Delete the removed player's row.
  requests.push({
    deleteDimension: {
      range: {
        sheetId: ladder.sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex + 1,
        endIndex: rowIndex + 2,
      },
    },
  });

  // Re-rank everyone below and fix opponent references.
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const currentRow = rows[i];
    if (!currentRow[0]) continue;

    const currentRank = parseInt(currentRow[0]);
    const newRank = currentRank - 1;

    requests.push({
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: i,
          endRowIndex: i + 1,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: newRank.toString() },
                userEnteredFormat: { horizontalAlignment: 'RIGHT' },
              },
            ],
          },
        ],
        fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment',
      },
    });

    if (currentRow[5] === 'Challenge' && currentRow[7]) {
      const oppRank = parseInt(currentRow[7]);

      if (oppRank > rankToRemove) {
        requests.push({
          updateCells: {
            range: {
              sheetId: ladder.sheetId,
              startRowIndex: i,
              endRowIndex: i + 1,
              startColumnIndex: 7,
              endColumnIndex: 8,
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: (oppRank - 1).toString() },
                    userEnteredFormat: { horizontalAlignment: 'RIGHT' },
                  },
                ],
              },
            ],
            fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment',
          },
        });
      } else if (oppRank === rankToRemove) {
        requests.push({
          updateCells: {
            range: {
              sheetId: ladder.sheetId,
              startRowIndex: i,
              endRowIndex: i + 1,
              startColumnIndex: 5,
              endColumnIndex: 8,
            },
            rows: [
              {
                values: [
                  { userEnteredValue: { stringValue: 'Available' } },
                  { userEnteredValue: { stringValue: '' } },
                  {
                    userEnteredValue: { stringValue: '' },
                    userEnteredFormat: { horizontalAlignment: 'RIGHT' },
                  },
                ],
              },
            ],
            fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment',
          },
        });
      }
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests },
    });
  }

  // Verify the ranks are now a clean 1..N sequence.
  let ranksAreCorrect = true;
  try {
    const verificationResult = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ladder.sheetName}!A2:A`,
    });
    const updatedRanks = verificationResult.data.values;
    if (updatedRanks) {
      for (let i = 0; i < updatedRanks.length; i++) {
        if (updatedRanks[i][0] && parseInt(updatedRanks[i][0]) !== i + 1) {
          ranksAreCorrect = false;
          break;
        }
      }
    }
  } catch (error) {
    logError('removalService: rank verification read failed', error);
    ranksAreCorrect = false;
  }

  // Ranks shifted and a challenge may have cleared — refresh both boards.
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS);
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.CHALLENGES);

  return { success: true, player, ranksAreCorrect };
}

module.exports = { removeCharacterByRank };
