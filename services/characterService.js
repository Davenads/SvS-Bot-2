// services/characterService.js
//
// Shared helpers for the self-serve #register panel: locate a caller's own
// characters across BOTH ladders and flip a character's status. The register
// panel is a single shared channel, so a click can't infer a ladder — instead
// we look the caller up by Discord id (column I / index 8) on each ladder.
//
// Column layout (A2:K): [0] rank [1] name [2] spec [3] element [4] discUser
//   [5] status [6] cDate [7] opp# [8] discordId [9] notes [10] cooldown

require('dotenv').config();
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { LADDERS } = require('../config/ladders');
const { logError } = require('../logger');

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Every character owned by `userId`, across all ladders. Each entry carries the
// resolved ladder object and the 1-based sheet row number so callers can write
// straight back without re-reading. `rowNum = i + 2` holds even with gaps
// because index 0 of an A2:K read is always sheet row 2.
async function findUserCharacters(userId) {
  const found = [];
  for (const key of Object.keys(LADDERS)) {
    const ladder = LADDERS[key];
    let rows = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ladder.sheetName}!A2:K`,
      });
      rows = res.data.values || [];
    } catch (error) {
      logError(`characterService: failed reading ${ladder.sheetName}`, error);
      continue;
    }
    rows.forEach((row, i) => {
      if (row[8] === userId && row[0] && row[1]) {
        found.push({
          ladderKey: ladder.key,
          ladder,
          rank: row[0],
          name: row[1],
          spec: row[2],
          element: row[3],
          status: row[5],
          opponent: row[7],
          rowNum: i + 2,
        });
      }
    });
  }
  return found;
}

// Every character owned by `userId` currently parked in an Extended Vacation
// tab, across all ladders. Used by the #register "Return from Extended Vacation"
// button so the caller can point a manager at the right character. The vacation
// tabs share the main A:K layout, but the row's rank is the ORIGINAL ladder rank
// the player will be reinserted at (that is what `/insert` uses).
async function findUserVacationCharacters(userId) {
  const found = [];
  for (const key of Object.keys(LADDERS)) {
    const ladder = LADDERS[key];
    let rows = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ladder.vacationTab}!A2:K`,
      });
      rows = res.data.values || [];
    } catch (error) {
      logError(`characterService: failed reading ${ladder.vacationTab}`, error);
      continue;
    }
    rows.forEach(row => {
      if (row[8] === userId && row[1]) {
        found.push({
          ladderKey: ladder.key,
          ladder,
          rank: row[0],
          name: row[1],
          spec: row[2],
          element: row[3],
        });
      }
    });
  }
  return found;
}

// Write a single character's Status cell (column F).
async function setCharacterStatus(ladder, rowNum, status) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!F${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[status]] },
  });
}

module.exports = { findUserCharacters, findUserVacationCharacters, setCharacterStatus };
