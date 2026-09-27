// Load environment variables
require('dotenv').config()

// Import necessary modules
const { SlashCommandBuilder } = require('discord.js')
const { google } = require('googleapis')
const { logError } = require('../logger')
const { getGoogleAuth } = require('../fixGoogleAuth')
const { getLadderFromChannel } = require('../utils/ladder')
const { resolveMatch } = require('../services/matchResult')

// Initialize the Google Sheets API client (used only for the read below;
// the resolution/write path lives in services/matchResult.js).
const sheets = google.sheets({
  version: 'v4',
  auth: getGoogleAuth()
})

const SPREADSHEET_ID = process.env.SPREADSHEET_ID

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
    // Infer the ladder from the channel the command was run in. The standard
    // SvS challenge channel resolves to main; the LLD challenge channel resolves
    // to lld. Any other channel is rejected.
    const ladder = getLadderFromChannel(interaction.channelId)
    if (!ladder) {
      return await interaction.reply({
        content: 'This command can only be used in a challenge channel.',
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
        range: `${ladder.sheetName}!A2:K`
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

      // Permission check — a participant or an SvS Manager may report.
      const userId = interaction.user.id
      const hasPermission =
        userId === winnerRow[8] ||
        userId === loserRow[8] ||
        interaction.member.roles.cache.some(role => role.name === 'SvS Manager')

      if (!hasPermission) {
        console.log('└─ Error: User lacks permission')
        return interaction.editReply({
          content: 'You do not have permission to report this challenge result.'
        })
      }

      // Delegate the full resolution (rank swap, Redis clear + cooldown, thread
      // archive, title-defend metrics, announcement embed, board refresh) to the
      // shared service so /reportwin and the vacation-forfeit path stay identical.
      const { isDefense } = await resolveMatch(interaction.client, ladder, {
        rows,
        winnerRow,
        loserRow,
        announceChannel: interaction.channel
      })

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
