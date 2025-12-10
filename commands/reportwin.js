// Load environment variables
require('dotenv').config()

// Import necessary modules
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { google } = require('googleapis')
const { logError } = require('../logger')
const redisClient = require('../redis-client');
const { getGoogleAuth } = require('../fixGoogleAuth');

// Initialize the Google Sheets API client
const sheets = google.sheets({
  version: 'v4',
  auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID
const sheetId = 0 // Numeric sheetId for 'SvS Ladder' tab

// Emoji and color mappings for visual enhancement
const elementEmojis = {
  Fire: '🔥',
  Light: '⚡',
  Cold: '❄️'
}

const specEmojis = {
  Vita: '❤️',
  ES: '🟠'
}

const elementColors = {
  Fire: { red: 0.976, green: 0.588, blue: 0.51 }, // #f99682
  Light: { red: 1, green: 0.925, blue: 0.682 }, // #ffecae
  Cold: { red: 0.498, green: 0.631, blue: 1 } // #7fa1ff
}

// Victory messages for different scenarios
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportwin')
    .setDescription('Report the results of a challenge')
    .addIntegerOption(option =>
      option
        .setName('winner_rank')
        .setDescription('The rank number of the winner')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('loser_rank')
        .setDescription('The rank number of the loser')
        .setRequired(true)
    ),

  async execute (interaction) {
    if (interaction.channelId !== '1330563945341390959') {
      return await interaction.reply({
        content: 'This command can only be used in the #challenges channel.',
        ephemeral: true
      })
    }
    await interaction.deferReply({ ephemeral: true })
    console.log(`\n[${new Date().toISOString()}] Report Win Command`)
    console.log(
      `├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`
    )

    const winnerRank = interaction.options.getInteger('winner_rank')
    const loserRank = interaction.options.getInteger('loser_rank')

    console.log(`├─ Winner Rank: ${winnerRank}`)
    console.log(`├─ Loser Rank: ${loserRank}`)
    try {
      // Fetch data from the Google Sheet
      console.log('├─ Fetching data from Google Sheets...')
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `SvS Ladder!A2:K`
      })

      const rows = result.data.values
      if (!rows?.length) {
        console.log('└─ Error: No data found in leaderboard')
        return interaction.editReply({
          content: 'No data available on the leaderboard.'
        })
      }

      // Find the winner and loser rows
      const winnerRow = rows.find(row => parseInt(row[0]) === winnerRank)
      const loserRow = rows.find(row => parseInt(row[0]) === loserRank)

      if (!winnerRow || !loserRow) {
        console.log('└─ Error: Invalid ranks provided')
        return interaction.editReply({ content: 'Invalid ranks provided.' })
      }

      // Permission check
      const userId = interaction.user.id
      const winnerDiscordId = winnerRow[8]
      const loserDiscordId = loserRow[8]
      const hasPermission =
        userId === winnerDiscordId ||
        userId === loserDiscordId ||
        interaction.member.roles.cache.some(role => role.name === 'SvS Manager')

      if (!hasPermission) {
        console.log('└─ Error: User lacks permission')
        return interaction.editReply({
          content: 'You do not have permission to report this challenge result.'
        })
      }

      console.log('├─ Processing match result...')

      // Store player details
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

      // Prepare row updates
      let updatedWinnerRow = [...winnerRow]
      let updatedLoserRow = [...loserRow]

      if (!isDefense) {
        // Swap rows for climb victory
        console.log('├─ Performing rank swap...')
        updatedWinnerRow = [...loserRow]
        updatedWinnerRow[0] = String(winnerRow[0])

        updatedLoserRow = [...winnerRow]
        updatedLoserRow[0] = String(loserRow[0])

        // Swap Notes and Cooldown
        ;[updatedWinnerRow[9], updatedLoserRow[9]] = [loserRow[9], winnerRow[9]]
        ;[updatedWinnerRow[10], updatedLoserRow[10]] = [
          loserRow[10],
          winnerRow[10]
        ]
      } else {
        updatedWinnerRow[0] = String(updatedWinnerRow[0])
        updatedLoserRow[0] = String(updatedLoserRow[0])
      }

      // Reset challenge status
      updatedWinnerRow[5] = 'Available'
      updatedWinnerRow[6] = ''
      updatedWinnerRow[7] = ''
      updatedLoserRow[5] = 'Available'
      updatedLoserRow[6] = ''
      updatedLoserRow[7] = ''

      const winnerRowIndex =
        rows.findIndex(row => parseInt(row[0]) === winnerRank) + 2
      const loserRowIndex =
        rows.findIndex(row => parseInt(row[0]) === loserRank) + 2

      // Create update requests
      console.log('├─ Preparing update requests...')
      const requests = [
        {
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: winnerRowIndex - 1,
              endRowIndex: winnerRowIndex,
              startColumnIndex: 0,
              endColumnIndex: 11
            },
            rows: [
              {
                values: updatedWinnerRow.map((cellValue, index) => ({
                  userEnteredValue: { stringValue: cellValue },
                  userEnteredFormat:
                    index === 0 ? { horizontalAlignment: 'RIGHT' } : {}
                }))
              }
            ],
            fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
          }
        },
        {
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: loserRowIndex - 1,
              endRowIndex: loserRowIndex,
              startColumnIndex: 0,
              endColumnIndex: 11
            },
            rows: [
              {
                values: updatedLoserRow.map((cellValue, index) => ({
                  userEnteredValue: { stringValue: cellValue },
                  userEnteredFormat:
                    index === 0 ? { horizontalAlignment: 'RIGHT' } : {}
                }))
              }
            ],
            fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
          }
        }
      ]

      // Add element color updates
      const elementUpdateRequests = [
        {
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: winnerRowIndex - 1,
              endRowIndex: winnerRowIndex,
              startColumnIndex: 3,
              endColumnIndex: 4
            },
            rows: [
              {
                values: [
                  {
                    userEnteredFormat: {
                      backgroundColor: elementColors[updatedWinnerRow[3]]
                    }
                  }
                ]
              }
            ],
            fields: 'userEnteredFormat.backgroundColor'
          }
        },
        {
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: loserRowIndex - 1,
              endRowIndex: loserRowIndex,
              startColumnIndex: 3,
              endColumnIndex: 4
            },
            rows: [
              {
                values: [
                  {
                    userEnteredFormat: {
                      backgroundColor: elementColors[updatedLoserRow[3]]
                    }
                  }
                ]
              }
            ],
            fields: 'userEnteredFormat.backgroundColor'
          }
        }
      ]

      // Execute updates
      console.log('├─ Executing sheet updates...')
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [...requests, ...elementUpdateRequests] }
      })

      // Remove challenge from Redis (if it exists)
      try {
        const winnerPlayer = {
          discordId: winnerRow[8],
          element: winnerRow[3]
        };
        const loserPlayer = {
          discordId: loserRow[8],
          element: loserRow[3]
        };
        await redisClient.removeChallenge(winnerPlayer, loserPlayer);
        console.log('├─ Removed challenge from Redis tracking');
      } catch (error) {
        console.error('Error removing challenge from Redis:', error);
        // Continue with the report even if Redis removal fails
      }

      // Create result announcement embed
      const victoryMessage = isDefense
        ? victoryMessages.defense[
            Math.floor(Math.random() * victoryMessages.defense.length)
          ]
        : victoryMessages.climb[
            Math.floor(Math.random() * victoryMessages.climb.length)
          ]

      // Add this new code block for title defends before the embed creation
      if (winnerRank === 1) {
        console.log('Processing title defense metrics...')

        try {
          // Fetch current metrics data
          const metricsResult = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Metrics!A11:C'
          })

          const metricsRows = metricsResult.data.values || []

          // Find if player already exists
          const playerRowIndex = metricsRows.findIndex(
            row => row[1] === winnerRow[8]
          ) // Use winnerRow[8] directly for Discord ID

          if (playerRowIndex === -1) {
            // New player - append to the list
            await sheets.spreadsheets.values.append({
              spreadsheetId: SPREADSHEET_ID,
              range: 'Metrics!A11:C',
              valueInputOption: 'USER_ENTERED',
              resource: {
                values: [
                  [
                    winnerRow[4], // Discord Username
                    winnerRow[8], // Discord ID
                    '1'
                  ]
                ]
              }
            })
            console.log('New title defender added to metrics')
          } else {
            // Existing player - update their count
            const currentDefenses =
              parseInt(metricsRows[playerRowIndex][2] || '0') + 1
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `Metrics!A${11 + playerRowIndex}:C${11 + playerRowIndex}`,
              valueInputOption: 'USER_ENTERED',
              resource: {
                values: [
                  [
                    winnerRow[4], // Discord Username
                    winnerRow[8], // Discord ID
                    currentDefenses.toString()
                  ]
                ]
              }
            })
            console.log('Existing title defender metrics updated')
          }
        } catch (error) {
          console.error('Error updating title defense metrics:', error)
        }
      }
      // Set the cooldown for both players
      const player1 = {
        discordId: winnerRow[8],
        element: winnerRow[3]
      }

      const player2 = {
        discordId: loserRow[8],
        element: loserRow[3]
      }

      // Set cooldown in Redis
      try {
        await redisClient.setCooldown(player1, player2)
        console.log('Cooldown set successfully for match:', {
          winner: player1.discordId,
          loser: player2.discordId
        })
      } catch (cooldownError) {
        console.error('Error setting cooldown:', cooldownError)
        // Don't throw error here - continue with match reporting even if cooldown fails
      }
      const resultEmbed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('⚔️ Challenge Result Announced! ⚔️')
        .setDescription(`**${winnerDetails.name}** ${victoryMessage}`)
        .addFields(
          {
            name: `${
              isDefense ? '🛡️ Defender' : '🏆 Victor'
            } (Rank #${winnerRank})`,
            value: `**${winnerDetails.name}**
${specEmojis[winnerDetails.spec]} ${winnerDetails.spec} ${
              elementEmojis[winnerDetails.element]
            }
<@${winnerDiscordId}>`,
            inline: true
          },
          {
            name: '⚔️',
            value: 'VS',
            inline: true
          },
          {
            name: `${
              isDefense ? '⚔️ Challenger' : '📉 Defeated'
            } (Rank #${loserRank})`,
            value: `**${loserDetails.name}**
${specEmojis[loserDetails.spec]} ${loserDetails.spec} ${
              elementEmojis[loserDetails.element]
            }
<@${loserDiscordId}>`,
            inline: true
          }
        )
        .setFooter({
          text: `${
            isDefense
              ? 'Rank Successfully Defended!'
              : 'Ranks have been updated!'
          }`,
          iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp()

      // Send result to channel
      await interaction.channel.send({ embeds: [resultEmbed] })

      // Confirm to command user
      await interaction.editReply({
        content: `Successfully reported the match result! ${
          isDefense
            ? 'Defender maintained their position.'
            : 'Ranks have been swapped.'
        }`
      })

      console.log('└─ Command completed successfully')
    } catch (error) {
      console.error(`└─ Error: ${error.message}`)
      logError('Error in reportwin command', error)

      await interaction.editReply({
        content:
          'An error occurred while reporting the match result. Please try again later.'
      })
    }
  }
}
