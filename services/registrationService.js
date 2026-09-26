// services/registrationService.js
//
// Shared character-registration core used by BOTH the manager slash command
// (/register) and the self-serve #register "Sign Up" wizard. Keeping the sheet
// write in one place guarantees the two paths produce identical rows, formatting
// and data validation. See CHANNEL_DASHBOARDS_PLAN.md §6.
//
// Column layout (A2:K): [0] rank [1] name [2] spec [3] element [4] discUser
//   [5] status [6] cDate [7] opp# [8] discordId [9] notes [10] cooldown

require('dotenv').config();
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { refreshDashboard } = require('../dashboards/refresh');
const { DASHBOARD_PANELS } = require('../config/ladders');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Element cell background colors (column D), matching the legacy /register look.
const ELEMENT_BG = {
  Cold: { red: 0.5, green: 0.635, blue: 1 },
  Fire: { red: 0.976, green: 0.588, blue: 0.51 },
  Light: { red: 1, green: 0.929, blue: 0.686 },
};

// Elements already registered to `discordId` on this ladder. Used to enforce the
// "one character per element per ladder" rule in the self-serve Sign Up wizard.
async function getTakenElements(ladder, discordId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`,
  });
  const rows = res.data.values || [];
  return rows.filter(r => r[8] === discordId && r[1]).map(r => r[3]);
}

// Write a brand-new character to the first empty row of `ladder`. Copies the
// spec/element/status formatting + data validation from row 2, paints the
// element background, bolds the name, forces status to Available, then refreshes
// the rankings board. Returns { rank }. Throws on API failure so callers can
// surface an error.
async function writeNewCharacter(
  client,
  ladder,
  { characterName, spec, element, discUser, discUserId, notes }
) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`,
  });
  const rows = result.data.values || [];

  // First empty row by Name column (B); default to appending at the end.
  let emptyRowIndex = rows.length + 2;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i][1]) {
      emptyRowIndex = i + 2;
      break;
    }
  }

  const rank = emptyRowIndex - 1;
  const newCharacterRow = [
    rank, // Rank
    characterName, // Name
    spec, // Spec
    element, // Element
    discUser, // Discord username
    'Available', // Status
    '', // cDate
    '', // Opp#
    discUserId, // Discord user ID
    notes || '', // Notes
    '', // Cooldown
  ];

  const copyRowIndex = 1; // Row 2 holds the desired Spec/Element/Status formatting.
  const requests = [
    {
      copyPaste: {
        source: {
          sheetId: ladder.sheetId,
          startRowIndex: copyRowIndex,
          endRowIndex: copyRowIndex + 1,
          startColumnIndex: 2,
          endColumnIndex: 6,
        },
        destination: {
          sheetId: ladder.sheetId,
          startRowIndex: emptyRowIndex - 1,
          endRowIndex: emptyRowIndex,
          startColumnIndex: 2,
          endColumnIndex: 6,
        },
        pasteType: 'PASTE_FORMAT',
      },
    },
    {
      copyPaste: {
        source: {
          sheetId: ladder.sheetId,
          startRowIndex: copyRowIndex,
          endRowIndex: copyRowIndex + 1,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        destination: {
          sheetId: ladder.sheetId,
          startRowIndex: emptyRowIndex - 1,
          endRowIndex: emptyRowIndex,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        pasteType: 'PASTE_DATA_VALIDATION',
      },
    },
    {
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: emptyRowIndex - 1,
          endRowIndex: emptyRowIndex,
          startColumnIndex: 3, // Element column (D)
          endColumnIndex: 4,
        },
        rows: [
          {
            values: [
              {
                userEnteredFormat: {
                  backgroundColor: ELEMENT_BG[element] || ELEMENT_BG.Light,
                },
              },
            ],
          },
        ],
        fields: 'userEnteredFormat.backgroundColor',
      },
    },
    {
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: emptyRowIndex - 1,
          endRowIndex: emptyRowIndex,
          startColumnIndex: 1, // Name column (B)
          endColumnIndex: 2,
        },
        rows: [
          {
            values: [
              {
                userEnteredFormat: { textFormat: { bold: true } },
              },
            ],
          },
        ],
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A${emptyRowIndex}:K`,
    valueInputOption: 'RAW',
    resource: { values: [newCharacterRow] },
  });

  // Force Status back to Available in case the pasted data validation cleared it.
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!F${emptyRowIndex}`,
    valueInputOption: 'RAW',
    resource: { values: [['Available']] },
  });

  // Refresh the live rankings board (new character added).
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS);

  return { rank };
}

module.exports = { writeNewCharacter, getTakenElements };
