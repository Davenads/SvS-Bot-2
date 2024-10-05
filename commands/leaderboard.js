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
        try {
            // Fetch data from the Google Sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H36`, // Adjust range as needed
            });

            const rows = result.data.values;
            if (!rows.length) {
                return interaction.reply({ content: 'No data available on the leaderboard.', ephemeral: true });
            }

            const embeds = [];
            let currentEmbed = new EmbedBuilder()
                .setColor(0x00AE86) // Set color
                .setTitle('🏆 SvS Ladder Leaderboard 🏆')
                .setDescription('Current standings in the SvS Ladder.')
                .setTimestamp()
                .setFooter({ text: 'SvS Bot Leaderboard', iconURL: interaction.client.user.displayAvatarURL() });

            // Emojis for Spec and Element
            const specEmojiMap = {
                Vita: '❤️',  // Vita Spec
                ES: '🟠'    // ES Spec
            };
            const elementEmojiMap = {
                Fire: '🔥',
                Light: '⚡',
                Cold: '❄️'
            };

            // Process rows into multiple embeds if necessary
            rows.forEach((row, index) => {
                const rank = row[0] || 'N/A';
                const name = row[1] || 'Unknown';
                const spec = row[2] || 'Unknown'; // Vita or ES
                const element = row[3] || 'Unknown'; // Fire, Light, or Cold
                const status = row[5] || 'Available';

                // Consolidating spec and element into one line next to the player's name
                const specAndElement = `${specEmojiMap[spec] || ''}${elementEmojiMap[element] || ''}`;

                currentEmbed.addFields({
                    name: `#${rank} - ${name} ${specAndElement}`, // Player's name with spec and element emojis
                    value: `Status: ${status}`,
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

            // If only one embed is required
            if (embeds.length === 1) {
                return await interaction.reply({ embeds: [embeds[0]], ephemeral: true });
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

            const message = await interaction.reply({
                embeds: [embeds[currentPage]],
                components: [buttonRow],
                fetchReply: true,
                ephemeral: true, // Respond only to the user
            });

            const collector = message.createMessageComponentCollector({
                time: 60000, // Time to listen for button clicks (60 seconds)
            });

            collector.on('collect', async (buttonInteraction) => {
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
                interaction.editReply({
                    components: [], // Remove buttons after the collector ends
                });
            });
        } catch (error) {
            await interaction.reply({ content: 'There was an error retrieving the leaderboard data.', ephemeral: true });
        }
    },
};