const { SlashCommandBuilder, EmbedBuilder } = require('discord.js')
const { logError } = require('../logger')
const { getLadderFromOption } = require('../utils/ladder');
const { removeCharacterByRank } = require('../services/removalService');

// Emoji mappings
const elementEmojis = {
  Fire: '🔥',
  Light: '⚡',
  Cold: '❄️'
}

const specEmojis = {
  Vita: '❤️',
  ES: '🟠'
}

const farewellMessages = [
  'May your adventures continue beyond the ladder! 🌟',
  'Your legacy in the ladder will be remembered! ⚔️',
  'Until we meet again, brave warrior! 👋',
  'The ladder will miss your presence! 🎭',
  'Your chapter in our story may end, but your legend lives on! 📖',
  'Farewell, noble challenger! 🏰',
  'May your future battles be glorious! ⚔️',
  'Your name shall echo in the halls of the ladder! 🏛️'
]

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Permanently remove a player from the ladder')
    .addIntegerOption(option =>
      option
        .setName('rank')
        .setDescription('The rank number of the player to remove')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('ladder')
        .setDescription('Which ladder (defaults to HLD)')
        .setRequired(false)
        .addChoices(
          { name: 'HLD', value: 'main' },
          { name: 'LLD', value: 'lld' }
        )
    ),

  async execute (interaction) {
    console.log(`\n[${new Date().toISOString()}] Remove Command`)
    console.log(`├─ Invoked by: ${interaction.user.tag}`)

    await interaction.deferReply({ ephemeral: true })

    // Resolve the ladder from the optional `ladder` option (default: main).
    const ladder = getLadderFromOption(interaction)

    // Check if the user has the '@SvS Manager' role
    const managerRole = interaction.guild.roles.cache.find(
      role => role.name === 'SvS Manager'
    )
    if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
      return interaction.editReply({
        content:
          'You do not have the required @SvS Manager role to use this command.',
        ephemeral: true
      })
    }

    try {
      const rankToRemove = interaction.options.getInteger('rank')

      console.log('├─ Removing Player:')
      console.log(`│  └─ Rank: #${rankToRemove}`)

      // All sheet mutation, re-ranking, Redis cleanup, and board refreshes live
      // in the shared removal service (also used by the #register Leave button).
      const result = await removeCharacterByRank(interaction.client, ladder, rankToRemove)
      if (!result.success) {
        console.log(`└─ Error: ${result.reason}`)
        return interaction.editReply({ content: result.reason, ephemeral: true })
      }

      const { player, ranksAreCorrect } = result
      console.log(`└─ Rank verification: ${ranksAreCorrect ? 'Success' : 'Failed'}`)

      // Create farewell embed
      const farewellEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('👋 Farewell from the Ladder!')
        .setDescription(
          farewellMessages[Math.floor(Math.random() * farewellMessages.length)]
        )
        .addFields(
          {
            name: '🎭 Character',
            value: `**${player.name}** (Rank #${player.rank})`,
            inline: true
          },
          {
            name: '⚔️ Build',
            value: `${specEmojis[player.spec] || ''} ${player.spec} ${
              elementEmojis[player.element] || ''
            } ${player.element}`,
            inline: true
          },
          {
            name: '👤 Discord',
            value: player.discordId ? `<@${player.discordId}>` : player.discordUsername,
            inline: true
          }
        )
        .setFooter({
          text: `Player removed from the ladder. ${
            ranksAreCorrect
              ? 'All ladder ranks updated successfully!'
              : 'Rank verification needed.'
          }`,
          iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp()

      // Send the embed to the channel
      await interaction.channel.send({ embeds: [farewellEmbed] })

      // Send confirmation to command issuer
      await interaction.editReply({
        content: `Successfully removed ${player.name} from the ladder and updated all affected rankings and challenges.`,
        ephemeral: true
      })
    } catch (error) {
      console.error(`└─ Error: ${error.message}`)
      logError(`Error removing player: ${error.message}\nStack: ${error.stack}`)
      return interaction.editReply({
        content:
          'An error occurred while removing the player. Please try again later.',
        ephemeral: true
      })
    }
  }
}
