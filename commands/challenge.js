require('dotenv').config()
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { google } = require('googleapis')
const { logError } = require('../logger')
const redisClient = require('../redis-client');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { getLadderFromChannel } = require('../utils/ladder');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
  });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID

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
        range: `${ladder.sheetName}!A2:I`
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

      // Filter out vacation players and challenger's own characters
      const availablePlayersBetween = playersBetween.filter(row => {
        // Filter out vacation players
        if (row[5] === 'Vacation') return false

        // Filter out challenger's own characters
        if (row[8] === userId) return false

        return true
      })
      const availableJumpSize = availablePlayersBetween.length + 1

      console.log(`├─ Challenge Analysis:`)
      console.log(`│  ├─ Players between: ${playersBetween.length}`)
      console.log(
        `│  ├─ Available players between: ${availablePlayersBetween.length}`
      )
      console.log(`│  └─ Effective jump size: ${availableJumpSize}`)

      // Special restriction for challenging top 10 players
      if (targetRank <= ladder.top10Threshold && challengerRank > ladder.top10Threshold) {
        if (availableJumpSize > ladder.top10MaxJump) {
          console.log(
            '└─ Rejected: Non-top 10 player attempting to challenge top 10 beyond limit'
          )
          const maxAllowedRank = challengerRank - ladder.top10MaxJump
          return await interaction.editReply({
            content: `Players outside top 10 can only challenge up to ${ladder.top10MaxJump} ranks ahead when targeting top 10 players. The highest rank you can challenge is ${maxAllowedRank}.`
          })
        }
      } else if (challengerRank <= ladder.top10Threshold) {
        // Top 10 restriction
        if (availableJumpSize > ladder.top10MaxJump) {
          console.log('└─ Rejected: Top 10 player exceeding max jump')
          const maxTarget = rows.find(
            row =>
              parseInt(row[0]) === challengerRank - ladder.top10MaxJump &&
              row[5] !== 'Vacation'
          )
          return await interaction.editReply({
            content: `Top 10 players can only challenge up to ${ladder.top10MaxJump} ranks ahead. The highest rank you can challenge is ${
              maxTarget ? maxTarget[0] : challengerRank - ladder.top10MaxJump
            }.`
          })
        }
      } else {
        // Regular player restriction
        if (availableJumpSize > ladder.regularMaxJump) {
          console.log('└─ Rejected: Regular player exceeding max jump')
          const maxTarget = rows.find(
            row =>
              parseInt(row[0]) === challengerRank - ladder.regularMaxJump &&
              row[5] !== 'Vacation'
          )
          const skippedRanks = availablePlayersBetween
            .map(row => row[0])
            .join(', ')
          return await interaction.editReply({
            content: `Players outside top 10 can only challenge up to ${ladder.regularMaxJump} ranks ahead (excluding players on vacation). You're trying to skip ranks: ${skippedRanks}`
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

      const cooldownCheck = await redisClient.checkCooldown(player1, player2, ladder)

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
          range: `${ladder.sheetName}!F${challengerRowIndex}:H${challengerRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [['Challenge', challengeDate, targetRank]] }
        }),
        sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${ladder.sheetName}!F${targetRowIndex}:H${targetRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [['Challenge', challengeDate, challengerRank]] }
        })
      ]

      await Promise.all(updatePromises)
      console.log('├─ Challenge status updated successfully')

      // Store challenge in Redis with expiration
      const challenger = {
        discordId: challengerRow[8],
        name: challengerRow[1],
        element: challengerRow[3],
        rank: challengerRank
      }

      const target = {
        discordId: targetRow[8],
        name: targetRow[1],
        element: targetRow[3],
        rank: targetRank
      }

      // Set the challenge in Redis with the 3-day TTL
      await redisClient.setChallenge(challenger, target, challengeDate, ladder)
      console.log('├─ Challenge set in Redis with 3-day expiration')

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
          text: 'May the best player win! Challenge expires in 3 days.',
          iconURL: interaction.client.user.displayAvatarURL()
        })

      await interaction.channel.send({ embeds: [challengeEmbed] })
      await interaction.editReply({
        content: 'Challenge successfully initiated!'
      })
      console.log('└─ Challenge command completed successfully')
    } catch (error) {
      console.log(`└─ Error executing challenge command: ${error.message}`)
      logError('Challenge command error', error)
      await interaction.editReply({
        content:
          'An error occurred while processing your challenge. Please try again later.'
      })
    }
  }
}
