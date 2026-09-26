require('dotenv').config()
const { SlashCommandBuilder } = require('discord.js')
const { logError } = require('../logger')
const { getLadderFromChannel } = require('../utils/ladder');
const { executeChallenge } = require('../services/challengeService');

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
    console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`)

    try {
      const challengerRank = interaction.options.getInteger('challenger_rank')
      const targetRank = interaction.options.getInteger('target_rank')
      const userId = interaction.user.id
      const isManager = interaction.member.roles.cache.some(role => role.name === 'SvS Manager')

      console.log(`├─ Challenge Request: #${challengerRank} -> #${targetRank}`)

      // All validation, cooldown, sheet write, Redis persistence, the challenge
      // announcement, and the board refreshes live in the shared service so the
      // slash command and the #issue-a-challenge button behave identically.
      const result = await executeChallenge(interaction.client, ladder, {
        challengerRank,
        targetRank,
        userId,
        isManager
      })

      if (!result.success) {
        console.log(`└─ Rejected: ${result.message}`)
        return await interaction.editReply({ content: result.message })
      }

      await interaction.editReply({ content: 'Challenge successfully initiated!' })
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
