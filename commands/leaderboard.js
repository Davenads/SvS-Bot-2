require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');

// Initialize Google Sheets API client
const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT(
    credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']
)});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder'; // Make sure this points to your current testing tab

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Displays the SvS leaderboard with specs and elements'),
    
    async execute(interaction) {
        console.log(`[${new Date().toISOString()}] Command invoked: /leaderboard by ${interaction.user.tag} (${interaction.user.id})`);
        let deferred = false;
        const deferIfNecessary = async () => {
            if (!deferred) {
                await interaction.deferReply({ ephemeral: true });
                deferred = true;
            }
        };

        try {
            await deferIfNecessary();

            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H`, // Adjust range to cover all rows dynamically
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                return await interaction.editReply({ content: 'No data available on the leaderboard.' });
            }

            const validRows = rows.filter(row => row[0] && row[1]); // Filter out rows with missing rank or name

            if (!validRows.length) {
                return await interaction.editReply({ content: 'No valid data available on the leaderboard.' });
            }

            const embeds = [];
            let currentEmbed = new EmbedBuilder()
                .setColor(0x00AE86) // Set color
                .setTitle('🏆 SvS Ladder Leaderboard 🏆')
                .setDescription('Current standings in the SvS Ladder.')
                .setTimestamp()
                .setFooter({ text: 'SvS Bot Leaderboard', iconURL: interaction.client.user.displayAvatarURL() });

            // Emojis for Element and Status
            const elementEmojiMap = {
                Fire: '🔥',
                Light: '⚡',
                Cold: '❄️'
            };
            const statusEmojiMap = {
                Available: '✅',
                Challenge: '❌',
                Vacation: '🌴'
            };

            // Process rows into multiple embeds if necessary
            validRows.forEach((row, index) => {
                const rank = row[0] || 'N/A';
                const name = row[1] || 'Unknown';
                const element = row[3] || 'Unknown'; // Fire, Light, or Cold
                const status = row[5] || 'Available';

                // Consolidating element and status into one line next to the player's name
                const elementEmoji = elementEmojiMap[element] || '';
                const statusEmoji = statusEmojiMap[status] || '';

                currentEmbed.addFields({
                    name: `#${rank} - ${name} ${elementEmoji}`, // Player's name with element emoji
                    value: `Status: ${statusEmoji} ${status}`,
                    inline: false
                });

                // If the current embed has reached 15 fields, push it to the array and create a new embed
                if ((index + 1) % 10 === 0 || index === validRows.length - 1) {
                    embeds.push(currentEmbed);
                    currentEmbed = new EmbedBuilder()
                        .setColor(0x00AE86)
                        .setTitle('🏆 SvS Ladder Leaderboard (continued) 🏆')
                        .setTimestamp()
                        .setFooter({ text: 'SvS Bot Leaderboard', iconURL: interaction.client.user.displayAvatarURL() });
                }
            });

            // If only one embed is required
            if (embeds.length === 1) {
                return await interaction.editReply({ embeds: [embeds[0]] });
            }

            // Pagination logic with buttons
            let currentPage = 0;
            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('first')
                    .setLabel('First')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true), // Initially disable the 'First' button
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true), // Initially disable the 'Previous' button
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(embeds.length <= 1), // Disable if there's only one page
                new ButtonBuilder()
                    .setCustomId('last')
                    .setLabel('Last')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(embeds.length <= 1) // Disable if there's only one page
            );

            const message = await interaction.editReply({
                embeds: [embeds[currentPage]],
                components: [buttonRow],
            });

            const collector = message.createMessageComponentCollector({
                time: 60000, // Time to listen for button clicks (60 seconds)
            });

            collector.on('collect', async (buttonInteraction) => {
                if (buttonInteraction.customId === 'next') {
                    currentPage++;
                } else if (buttonInteraction.customId === 'previous') {
                    currentPage--;
                } else if (buttonInteraction.customId === 'first') {
                    currentPage = 0;
                } else if (buttonInteraction.customId === 'last') {
                    currentPage = embeds.length - 1;
                }

                await buttonInteraction.update({
                    embeds: [embeds[currentPage]],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('first')
                                .setLabel('First')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === 0),
                            new ButtonBuilder()
                                .setCustomId('previous')
                                .setLabel('Previous')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === 0),
                            new ButtonBuilder()
                                .setCustomId('next')
                                .setLabel('Next')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === embeds.length - 1),
                            new ButtonBuilder()
                                .setCustomId('last')
                                .setLabel('Last')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === embeds.length - 1)
                        ),
                    ],
                });
            });

            collector.on('end', () => {
                interaction.editReply({
                    components: [], // Remove buttons after the collector ends
                });
            });
        } catch (error) {
            logError(`Error during leaderboard execution: ${error.message}\nStack: ${error.stack}`);
            console.error(`Detailed error: ${error.message}`);
            await deferIfNecessary();
            await interaction.editReply({ content: 'There was an error retrieving the leaderboard data.' });
        }
    },
};
