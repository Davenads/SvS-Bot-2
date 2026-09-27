// services/matchResult.js
//
// Shared challenge-result resolution. Extracted from /reportwin so the same
// logic backs both the command and the vacation-forfeit path (a player who goes
// on vacation mid-challenge forfeits to their opponent — see
// VACATION_APPROVAL_AND_THREAD_FIX_PLAN.md §C).
//
// Given the winner/loser rows already read from the ladder sheet, resolveMatch:
//   - swaps ranks on a climb (or holds on a defense),
//   - resets both players to Available and clears their challenge columns,
//   - removes the Redis challenge + sets a cooldown,
//   - archives the coordination thread (best-effort),
//   - updates title-defend metrics on a rank-#1 win when the mode is enabled,
//   - announces the result embed to `announceChannel` (if provided),
//   - refreshes the live rankings + challenges boards.

require('dotenv').config()

const { EmbedBuilder } = require('discord.js')
const { google } = require('googleapis')
const redisClient = require('../redis-client')
const { getGoogleAuth } = require('../fixGoogleAuth')
const { refreshDashboard } = require('../dashboards/refresh')
const { DASHBOARD_PANELS } = require('../config/ladders')
const { archiveChallengeThread } = require('./challengeThreads')
const { specEmojiMap, elementEmojiMap } = require('../config/emoji')

const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() })
const SPREADSHEET_ID = process.env.SPREADSHEET_ID

// Element background colors mirrored onto the swapped/held rows (col D).
const elementColors = {
  Fire: { red: 0.976, green: 0.588, blue: 0.51 }, // #f99682
  Light: { red: 1, green: 0.925, blue: 0.682 }, // #ffecae
  Cold: { red: 0.498, green: 0.631, blue: 1 } // #7fa1ff
}

// Flavor lines for the result announcement.
const victoryMessages = {
  defense: [
    'defended their position with unwavering resolve! 🛡️',
    'stood their ground magnificently! ⚔️',
    'proved why they earned their rank! 🏆',
    'successfully protected their standing! 🛡️'
  ],
  climb: [
    'climbed the ranks with an impressive victory! 🏔️',
    'proved their worth and ascended! ⚡',
    'showed they deserve a higher position! 🌟',
    'conquered new heights in the ladder! 🎯'
  ]
}

// Resolve a challenge result. `rows` is the full A2:K read (used for row-index
// math), `winnerRow`/`loserRow` are the two players' rows from it, and
// `announceChannel` (optional) is where the result embed is posted. Returns
// resolution metadata plus the embed so callers can reuse it.
async function resolveMatch (client, ladder, { rows, winnerRow, loserRow, announceChannel }) {
  const winnerRank = parseInt(winnerRow[0])
  const loserRank = parseInt(loserRow[0])
  const winnerDiscordId = winnerRow[8]
  const loserDiscordId = loserRow[8]

  console.log('├─ Processing match result...')

  const winnerDetails = {
    name: winnerRow[1],
    discordName: winnerRow[4],
    element: winnerRow[3],
    spec: winnerRow[2]
  }
  const loserDetails = {
    name: loserRow[1],
    discordName: loserRow[4],
    element: loserRow[3],
    spec: loserRow[2]
  }

  const isDefense = winnerRank < loserRank
  console.log(`├─ Match Type: ${isDefense ? 'Defense' : 'Climb'}`)

  let updatedWinnerRow = [...winnerRow]
  let updatedLoserRow = [...loserRow]

  if (!isDefense) {
    // Swap rows for a climb victory.
    console.log('├─ Performing rank swap...')
    updatedWinnerRow = [...loserRow]
    updatedWinnerRow[0] = String(winnerRow[0])

    updatedLoserRow = [...winnerRow]
    updatedLoserRow[0] = String(loserRow[0])

    // Swap Notes and Cooldown columns along with the rank.
    ;[updatedWinnerRow[9], updatedLoserRow[9]] = [loserRow[9], winnerRow[9]]
    ;[updatedWinnerRow[10], updatedLoserRow[10]] = [loserRow[10], winnerRow[10]]
  } else {
    updatedWinnerRow[0] = String(updatedWinnerRow[0])
    updatedLoserRow[0] = String(updatedLoserRow[0])
  }

  // Reset challenge status on both rows.
  updatedWinnerRow[5] = 'Available'
  updatedWinnerRow[6] = ''
  updatedWinnerRow[7] = ''
  updatedLoserRow[5] = 'Available'
  updatedLoserRow[6] = ''
  updatedLoserRow[7] = ''

  const winnerRowIndex = rows.findIndex(row => parseInt(row[0]) === winnerRank) + 2
  const loserRowIndex = rows.findIndex(row => parseInt(row[0]) === loserRank) + 2

  console.log('├─ Preparing update requests...')
  const requests = [
    {
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: winnerRowIndex - 1,
          endRowIndex: winnerRowIndex,
          startColumnIndex: 0,
          endColumnIndex: 11
        },
        rows: [
          {
            values: updatedWinnerRow.map((cellValue, index) => ({
              userEnteredValue: { stringValue: cellValue },
              userEnteredFormat: index === 0 ? { horizontalAlignment: 'RIGHT' } : {}
            }))
          }
        ],
        fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
      }
    },
    {
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: loserRowIndex - 1,
          endRowIndex: loserRowIndex,
          startColumnIndex: 0,
          endColumnIndex: 11
        },
        rows: [
          {
            values: updatedLoserRow.map((cellValue, index) => ({
              userEnteredValue: { stringValue: cellValue },
              userEnteredFormat: index === 0 ? { horizontalAlignment: 'RIGHT' } : {}
            }))
          }
        ],
        fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
      }
    }
  ]

  const elementUpdateRequests = [
    {
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: winnerRowIndex - 1,
          endRowIndex: winnerRowIndex,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        rows: [
          { values: [{ userEnteredFormat: { backgroundColor: elementColors[updatedWinnerRow[3]] } }] }
        ],
        fields: 'userEnteredFormat.backgroundColor'
      }
    },
    {
      updateCells: {
        range: {
          sheetId: ladder.sheetId,
          startRowIndex: loserRowIndex - 1,
          endRowIndex: loserRowIndex,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        rows: [
          { values: [{ userEnteredFormat: { backgroundColor: elementColors[updatedLoserRow[3]] } }] }
        ],
        fields: 'userEnteredFormat.backgroundColor'
      }
    }
  ]

  console.log('├─ Executing sheet updates...')
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: [...requests, ...elementUpdateRequests] }
  })

  // Remove challenge from Redis (if it exists) and archive the coordination
  // thread. Thread teardown is fire-and-forget so its I/O never blocks the
  // caller — it swallows its own errors (§5.6).
  try {
    const winnerPlayer = { discordId: winnerRow[8], element: winnerRow[3] }
    const loserPlayer = { discordId: loserRow[8], element: loserRow[3] }
    await redisClient.removeChallenge(winnerPlayer, loserPlayer, ladder)
    console.log('├─ Removed challenge from Redis tracking')
    archiveChallengeThread(
      client,
      ladder,
      winnerPlayer,
      loserPlayer,
      `⚔️ Result reported — **${winnerDetails.name}** (#${winnerRank}) defeated **${loserDetails.name}** (#${loserRank}). Thread archived.`
    )
  } catch (error) {
    console.error('Error removing challenge from Redis:', error)
    // Continue with the report even if Redis removal fails.
  }

  const victoryMessage = isDefense
    ? victoryMessages.defense[Math.floor(Math.random() * victoryMessages.defense.length)]
    : victoryMessages.climb[Math.floor(Math.random() * victoryMessages.climb.length)]

  // Title defends (rank #1 wins only, when the mode is enabled).
  const titleDefendModeEnabled = await redisClient.getTitleDefendMode(ladder)
  if (winnerRank === 1 && !titleDefendModeEnabled) {
    console.log('├─ Title defend tracking disabled — skipping Metrics update')
  }
  if (winnerRank === 1 && titleDefendModeEnabled) {
    console.log('Processing title defense metrics...')
    try {
      // C = current-season defends, D = all-time.
      const metricsResult = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ladder.metricsTab}!A11:D`
      })
      const metricsRows = metricsResult.data.values || []
      const playerRowIndex = metricsRows.findIndex(row => row[1] === winnerRow[8])

      if (playerRowIndex === -1) {
        // New player — season + all-time both start at 1.
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${ladder.metricsTab}!A11:D`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[winnerRow[4], winnerRow[8], '1', '1']] }
        })
        console.log('New title defender added to metrics')
      } else {
        // Existing player — increment BOTH current-season (C) and all-time (D).
        const seasonDefenses = parseInt(metricsRows[playerRowIndex][2] || '0') + 1
        const allTimeDefenses = parseInt(metricsRows[playerRowIndex][3] || '0') + 1
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${ladder.metricsTab}!A${11 + playerRowIndex}:D${11 + playerRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[winnerRow[4], winnerRow[8], seasonDefenses.toString(), allTimeDefenses.toString()]]
          }
        })
        console.log('Existing title defender metrics updated')
      }
    } catch (error) {
      console.error('Error updating title defense metrics:', error)
    }
  }

  // Set the cooldown between the two players.
  try {
    await redisClient.setCooldown(
      { discordId: winnerRow[8], element: winnerRow[3] },
      { discordId: loserRow[8], element: loserRow[3] },
      ladder
    )
    console.log('Cooldown set successfully for match:', {
      winner: winnerDiscordId,
      loser: loserDiscordId
    })
  } catch (cooldownError) {
    console.error('Error setting cooldown:', cooldownError)
    // Don't throw — continue with match reporting even if cooldown fails.
  }

  const resultEmbed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle('⚔️ Challenge Result Announced! ⚔️')
    .setDescription(`**${winnerDetails.name}** ${victoryMessage}`)
    .addFields(
      {
        name: `${isDefense ? '🛡️ Defender' : '🏆 Victor'} (Rank #${winnerRank})`,
        value: `**${winnerDetails.name}**\n${specEmojiMap[winnerDetails.spec]} ${winnerDetails.spec} ${elementEmojiMap[winnerDetails.element]}\n<@${winnerDiscordId}>`,
        inline: true
      },
      { name: '⚔️', value: 'VS', inline: true },
      {
        name: `${isDefense ? '⚔️ Challenger' : '📉 Defeated'} (Rank #${loserRank})`,
        value: `**${loserDetails.name}**\n${specEmojiMap[loserDetails.spec]} ${loserDetails.spec} ${elementEmojiMap[loserDetails.element]}\n<@${loserDiscordId}>`,
        inline: true
      }
    )
    .setFooter({
      text: isDefense ? 'Rank Successfully Defended!' : 'Ranks have been updated!',
      iconURL: client.user.displayAvatarURL()
    })
    .setTimestamp()

  if (announceChannel) {
    await announceChannel.send({ embeds: [resultEmbed] })
  }

  // Refresh the live boards: ranks may have swapped (rankings) and the
  // challenge just resolved (active challenges).
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.RANKINGS)
  refreshDashboard(client, ladder.key, DASHBOARD_PANELS.CHALLENGES)

  return { isDefense, winnerRank, loserRank, winnerDetails, loserDetails, embed: resultEmbed }
}

// Forfeit path: a player who leaves an active challenge (goes on vacation / is
// benched) hands their opponent the win. Identified by discordId + element, this
// reads the ladder itself so it works on a fresh, self-consistent snapshot, then
// runs resolveMatch with the opponent as the winner. Returns
//   { forfeited: true, result, winnerName, loserName }              on success
//   { forfeited: false, reason }                                    otherwise
// The "nothing to forfeit" reasons (not-in-challenge, no-opponent, …) are normal
// outcomes, not errors, so callers can proceed regardless.
async function forfeitActiveChallenge (client, ladder, { discordId, element, announceChannel }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ladder.sheetName}!A2:K`
  })
  const rows = res.data.values || []

  const loserRow = rows.find(r => r[8] === discordId && r[3] === element)
  if (!loserRow) return { forfeited: false, reason: 'character-not-found' }
  if (String(loserRow[5] || '').toLowerCase() !== 'challenge') {
    return { forfeited: false, reason: 'not-in-challenge' }
  }

  const oppRank = parseInt(loserRow[7])
  if (!oppRank) return { forfeited: false, reason: 'no-opponent' }
  const winnerRow = rows.find(r => parseInt(r[0]) === oppRank)
  if (!winnerRow) return { forfeited: false, reason: 'opponent-not-found' }

  // Default the announcement to the ladder's challenge channel when the caller
  // didn't supply one.
  let channel = announceChannel || null
  if (!channel && ladder.challengeChannelId) {
    try {
      channel = await client.channels.fetch(ladder.challengeChannelId)
    } catch {
      channel = null
    }
  }

  const result = await resolveMatch(client, ladder, {
    rows,
    winnerRow,
    loserRow,
    announceChannel: channel
  })
  return { forfeited: true, result, winnerName: winnerRow[1], loserName: loserRow[1] }
}

module.exports = { resolveMatch, forfeitActiveChallenge }
