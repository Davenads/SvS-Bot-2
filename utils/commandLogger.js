const { EmbedBuilder } = require('discord.js');

// Logs channel ID where command logs will be posted
const LOGS_CHANNEL_ID = '1165300795277848587';

/**
 * Formats command arguments into a readable string
 * @param {CommandInteraction} interaction - The Discord interaction object
 * @returns {string} Formatted arguments string
 */
function formatCommandArgs(interaction) {
    const options = interaction.options.data;

    if (!options || options.length === 0) {
        return 'None';
    }

    const argStrings = options.map(opt => {
        let value = opt.value;

        // Handle different option types
        if (opt.user) {
            value = `@${opt.user.username}`;
        } else if (opt.channel) {
            value = `#${opt.channel.name}`;
        } else if (opt.role) {
            value = `@${opt.role.name}`;
        }

        return `**${opt.name}**: ${value}`;
    });

    return argStrings.join('\n');
}

/**
 * Logs command execution to the designated logs channel
 * @param {CommandInteraction} interaction - The Discord interaction object
 * @param {number} duration - Command execution duration in milliseconds
 * @param {Error|null} error - Error object if command failed, null if successful
 */
async function logCommandExecution(interaction, duration, error = null) {
    try {
        // Get the logs channel
        const logsChannel = await interaction.client.channels.fetch(LOGS_CHANNEL_ID);

        if (!logsChannel) {
            console.error('Logs channel not found');
            return;
        }

        // Determine if command succeeded or failed
        const isSuccess = !error;
        const embedColor = isSuccess ? '#00FF00' : '#FF0000'; // Green for success, Red for error
        const statusIcon = isSuccess ? '✅' : '❌';

        // Format duration (convert ms to seconds)
        const durationSeconds = (duration / 1000).toFixed(2);

        // Extract command information
        const commandName = `/${interaction.commandName}`;
        const username = interaction.user.username;
        const userId = interaction.user.id;
        const channelName = interaction.channel.name;
        const channelId = interaction.channelId;
        const args = formatCommandArgs(interaction);

        // Create the embed
        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${statusIcon} Command Executed: ${commandName}`)
            .addFields(
                {
                    name: '👤 User',
                    value: `${username} (${userId})`,
                    inline: true
                },
                {
                    name: '📍 Channel',
                    value: `#${channelName} (${channelId})`,
                    inline: true
                },
                {
                    name: '⏱️ Duration',
                    value: `${durationSeconds}s`,
                    inline: true
                }
            );

        // Add arguments field if there are any
        if (args !== 'None') {
            embed.addFields({
                name: '📝 Arguments',
                value: args,
                inline: false
            });
        }

        // Add error field if command failed
        if (error) {
            const errorMessage = error.message || 'Unknown error';
            embed.addFields({
                name: '❌ Error',
                value: `\`\`\`${errorMessage}\`\`\``,
                inline: false
            });
        }

        // Add footer with environment and timestamp
        embed.setFooter({ text: 'Production' });
        embed.setTimestamp();

        // Send the log embed
        await logsChannel.send({ embeds: [embed] });

    } catch (logError) {
        // Don't let logging errors crash the bot
        console.error('Error in commandLogger:', logError);
    }
}

module.exports = {
    logCommandExecution
};
