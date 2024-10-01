const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');

// Initialize Google Sheets API client
const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT(
    credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']
)});

const SPREADSHEET_ID = '1Ay8YGTGk1vUSTpD2DteeWeUxXlTCLdtvB-uFKDWIYEU';
const SHEET_NAME = 'Ladder Bot Testing'; // Make sure this points to your current testing tab

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Displays the SvS leaderboard with specs and elements'),
    
    async execute(interaction) {
        try {
            console.log('Leaderboard command executed'); // Log when the command is triggered
            console.log(`Interaction received from user: ${interaction.user.tag} (ID: ${interaction.user.id})`);
            console.log('Attempting to fetch leaderboard data from Google Sheets...');

            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H36`, // Adjust range as needed
            });

            console.log('Data successfully fetched from Google Sheets:', result.data);

            const rows = result.data.values;
            if (!rows.length) {
                console.warn('No data found in the specified range.');
                return interaction.reply({ content: 'No data available on the leaderboard.', ephemeral: true });
            }

            const embeds = [];
            let currentEmbed = new EmbedBuilder()
                .setColor(0x00AE86) // Set color
                .setTitle('🏆 SvS Ladder Leaderboard 🏆')
                .setDescription('Current standings in the SvS Ladder with respective specs and elements.')
                .setTimestamp()
                .setFooter({ text: 'SvS Bot Leaderboard', iconURL: interaction.client.user.displayAvatarURL() });

            // Process rows into multiple embeds if necessary
            rows.forEach((row, index) => {
                console.log(`Processing row ${index + 1}:`, row);
                
                const rank = row[0] || 'N/A';
                const name = row[1] || 'Unknown';
                const spec = row[2] || 'Unknown'; // Vita or ES
                const element = row[3] || 'Unknown'; // Fire, Light, or Cold
                const status = row[5] || 'Available';
                const emoji = spec === 'Vita' ? '💖' : '🟠';
                const elementEmoji = element === 'Fire' ? '🔥' : element === 'Light' ? '⚡' : '❄️';

                currentEmbed.addFields({
                    name: `#${rank} - ${name}`,
                    value: `**Spec**: ${spec} ${emoji}\n**Element**: ${element} ${elementEmoji}\n**Status**: ${status}`,
                    inline: false
                });

                // If the current embed has reached 25 fields, push it to the array and create a new embed
                if ((index + 1) % 10 === 0 || index === rows.length - 1) {
                    embeds.push(currentEmbed);
                    currentEmbed = new EmbedBuilder()
                        .setColor(0x00AE86)
                        .setTitle('🏆 SvS Ladder Leaderboard (continued) 🏆')
                        .setTimestamp()
                        .setFooter({ text: 'SvS Bot Leaderboard', iconURL: interaction.client.user.displayAvatarURL() });
                }
            });

            // Log the number of embeds created
            console.log(`Total embeds created: ${embeds.length}`);

            // If only one embed is required
            if (embeds.length === 1) {
                console.log('Sending single embed response.');
                return await interaction.reply({ embeds: [embeds[0]] });
            }

            // Pagination logic with buttons
            let currentPage = 0;
            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true), // Initially disable the 'Previous' button
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(embeds.length <= 1) // Disable if there's only one page
            );

            console.log('Sending paginated embed with buttons...');
            const message = await interaction.reply({
                embeds: [embeds[currentPage]],
                components: [buttonRow],
                fetchReply: true,
            });

            const collector = message.createMessageComponentCollector({
                time: 60000, // Time to listen for button clicks (60 seconds)
            });

            collector.on('collect', async (buttonInteraction) => {
                console.log(`Button interaction received: ${buttonInteraction.customId}`);

                if (buttonInteraction.customId === 'next') {
                    currentPage++;
                } else if (buttonInteraction.customId === 'previous') {
                    currentPage--;
                }

                await buttonInteraction.update({
                    embeds: [embeds[currentPage]],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('previous')
                                .setLabel('Previous')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === 0),
                            new ButtonBuilder()
                                .setCustomId('next')
                                .setLabel('Next')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === embeds.length - 1)
                        ),
                    ],
                });
            });

            collector.on('end', () => {
                console.log('Button collector ended. Disabling buttons...');
                interaction.editReply({
                    components: [], // Remove buttons after the collector ends
                });
            });
        } catch (error) {
            console.error('Error fetching leaderboard data:', error);
            await interaction.reply({ content: 'There was an error retrieving the leaderboard data.', ephemeral: true });
        }
    },
};
