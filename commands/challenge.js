require('dotenv').config()
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { logError } = require('../logger')
const redisClient = require('../redis-client');
const sheets = require('../google-sheets-client');



const SPREADSHEET_ID = process.env.SPREADSHEET_ID
const SHEET_NAME = 'SvS Ladder'
const TOP_10_MAX_JUMP = 2
const REGULAR_MAX_JUMP = 3
const TOP_10_THRESHOLD = 10

// Emoji maps for spec and element indicators
const specEmojiMap = {
  Vita: '❤️',
  ES: '🟠'
}

const elementEmojiMap = {
  Fire: '🔥',
  Light: '⚡',
  Cold: '❄️'
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Challenge a player on the leaderboard')
    .addIntegerOption(option =>
      option
        .setName('challenger_rank')
        .setDescription('Your rank on the leaderboard')
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option
        .setName('target_rank')
        .setDescription('The rank of the player you want to challenge')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute (interaction) {
    if (interaction.channelId !== '1330563945341390959') {
      return await interaction.reply({
        content: 'This command can only be used in the #challenges channel.',
        ephemeral: true
      })
    }
    await interaction.deferReply({ ephemeral: true })
    const timestamp = new Date().toISOString()
    console.log(`\n[${timestamp}] Challenge Command Execution Started`)
    console.log(
      `├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`
    )
    try {
      const challengerRank = interaction.options.getInteger('challenger_rank')
      const targetRank = interaction.options.getInteger('target_rank')
      const userId = interaction.user.id
      const memberRoles = interaction.member.roles.cache

      console.log(`├─ Challenge Request:`)
      console.log(`│  ├─ Challenger Rank: #${challengerRank}`)
      console.log(`│  └─ Target Rank: #${targetRank}`)

      // Prevent challenging downward in the ladder
      if (challengerRank <= targetRank) {
        console.log('└─ Rejected: Attempted to challenge downward')
        return await interaction.editReply({
          content: `You cannot challenge players ranked below you.`
        })
      }

      // Fetch ladder data
      console.log('├─ Fetching ladder data...')
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:I`
      })

      const rows = result.data.values
      if (!rows?.length) {
        console.log('└─ Error: No data available on the leaderboard')
        logError('No data available on the leaderboard.')
        return await interaction.editReply({
          content: 'Unable to access leaderboard data. Please try again later.'
        })
      }

      // Get available players between target and challenger
      const playersBetween = rows.filter(row => {
        const rank = parseInt(row[0])
        return rank > targetRank && rank < challengerRank
      })

      // Filter out vacation players
      const availablePlayersBetween = playersBetween.filter(
        row => row[5] !== 'Vacation'
      )
      const availableJumpSize = availablePlayersBetween.length + 1

      console.log(`├─ Challenge Analysis:`)
      console.log(`│  ├─ Players between: ${playersBetween.length}`)
      console.log(
        `│  ├─ Available players between: ${availablePlayersBetween.length}`
      )
      console.log(`│  └─ Effective jump size: ${availableJumpSize}`)

      // Special restriction for challenging top 10 players
      if (targetRank <= TOP_10_THRESHOLD && challengerRank > TOP_10_THRESHOLD) {
        if (availableJumpSize > TOP_10_MAX_JUMP) {
          console.log(
            '└─ Rejected: Non-top 10 player attempting to challenge top 10 beyond limit'
          )
          const maxAllowedRank = challengerRank - TOP_10_MAX_JUMP
          return await interaction.editReply({
            content: `Players outside top 10 can only challenge up to ${TOP_10_MAX_JUMP} ranks ahead when targeting top 10 players. The highest rank you can challenge is ${maxAllowedRank}.`
          })
        }
      } else if (challengerRank <= TOP_10_THRESHOLD) {
        // Top 10 restriction
        if (availableJumpSize > TOP_10_MAX_JUMP) {
          console.log('└─ Rejected: Top 10 player exceeding max jump')
          const maxTarget = rows.find(
            row =>
              parseInt(row[0]) === challengerRank - TOP_10_MAX_JUMP &&
              row[5] !== 'Vacation'
          )
          return await interaction.editReply({
            content: `Top 10 players can only challenge up to ${TOP_10_MAX_JUMP} ranks ahead. The highest rank you can challenge is ${
              maxTarget ? maxTarget[0] : challengerRank - TOP_10_MAX_JUMP
            }.`
          })
        }
      } else {
        // Regular player restriction
        if (availableJumpSize > REGULAR_MAX_JUMP) {
          console.log('└─ Rejected: Regular player exceeding max jump')
          const maxTarget = rows.find(
            row =>
              parseInt(row[0]) === challengerRank - REGULAR_MAX_JUMP &&
              row[5] !== 'Vacation'
          )
          const skippedRanks = availablePlayersBetween
            .map(row => row[0])
            .join(', ')
          return await interaction.editReply({
            content: `Players outside top 10 can only challenge up to ${REGULAR_MAX_JUMP} ranks ahead (excluding players on vacation). You're trying to skip ranks: ${skippedRanks}`
          })
        }
      }

      // Validate challenger and target
      console.log('├─ Validating challenger and target...')
      const challengerRow = rows.find(
        row => parseInt(row[0]) === challengerRank
      )
      const targetRow = rows.find(row => parseInt(row[0]) === targetRank)

      if (!challengerRow || !targetRow) {
        console.log('└─ Rejected: Invalid ranks provided')
        return await interaction.editReply({
          content: 'One or both ranks were not found on the leaderboard.'
        })
      }

      // Verify challenger identity
      if (
        challengerRow[8] !== userId &&
        !memberRoles.some(role => role.name === 'SvS Manager')
      ) {
        console.log('└─ Rejected: Unauthorized challenger')
        return await interaction.editReply({
          content: 'You can only initiate challenges for your own rank.'
        })
      }

      // NEW: Check for cooldown between players
      const player1 = {
        discordId: challengerRow[8],
        name: challengerRow[1],
        element: challengerRow[3]
      }

      const player2 = {
        discordId: targetRow[8],
        name: targetRow[1],
        element: targetRow[3]
      }

      const cooldownCheck = await redisClient.checkCooldown(player1, player2)

      if (cooldownCheck.onCooldown) {
        const remainingHours = Math.ceil(cooldownCheck.remainingTime / 3600)
        return await interaction.editReply({
          content: `You cannot challenge this player yet. Cooldown remains for ${remainingHours} hours.`
        })
      }
      // Check availability
      if (challengerRow[5] !== 'Available' || targetRow[5] !== 'Available') {
        console.log('└─ Rejected: Player(s) not available')
        return await interaction.editReply({
          content: `Challenge failed: ${
            challengerRow[5] !== 'Available' ? 'You are' : 'Your target is'
          } not available for challenges.`
        })
      }

      // Format challenge date
      const challengeDate = new Date().toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
        timeZone: 'America/New_York',
        timeZoneName: 'short'
      })

      console.log('├─ Updating challenge status...')

      // Update both players' status
      const challengerRowIndex =
        rows.findIndex(row => parseInt(row[0]) === challengerRank) + 2
      const targetRowIndex =
        rows.findIndex(row => parseInt(row[0]) === targetRank) + 2

      const updatePromises = [
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!F${challengerRowIndex}:H${challengerRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [['Challenge', challengeDate, targetRank]] }
        }),
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!F${targetRowIndex}:H${targetRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [['Challenge', challengeDate, challengerRank]] }
        })
      ]

      await Promise.all(updatePromises)
      console.log('├─ Challenge status updated successfully')

      // Create and send announcement embed
      const challengeEmbed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle('⚔️ New Challenge Initiated!')
        .addFields(
          {
            name: 'Challenger',
            value: `Rank #${challengerRank} (<@${challengerRow[8]}>)
${specEmojiMap[challengerRow[2]] || ''} ${
              elementEmojiMap[challengerRow[3]] || ''
            }`,
            inline: true
          },
          {
            name: '​',
            value: 'VS',
            inline: true
          },
          {
            name: 'Challenged',
            value: `Rank #${targetRank} (<@${targetRow[8]}>)
${specEmojiMap[targetRow[2]] || ''} ${elementEmojiMap[targetRow[3]] || ''}`,
            inline: true
          }
        )
        .setTimestamp()
        .setFooter({
          text: 'May the best player win!',
          iconURL: interaction.client.user.displayAvatarURL()
        })

      await interaction.channel.send({ embeds: [challengeEmbed] })
      await interaction.editReply({
        content: 'Challenge successfully initiated!'
      })
      console.log('└─ Challenge command completed successfully')
    } catch (error) {
      console.log(`└─ Error executing challenge command: ${error.message}`)
      logError(
        `Challenge command error: ${error.message}\nStack: ${error.stack}`
      )
      await interaction.editReply({
        content:
          'An error occurred while processing your challenge. Please try again later.'
      })
    }
  }
}
