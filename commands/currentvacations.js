require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger'); // Import the logger
const { getGoogleAuth } = require('../fixGoogleAuth');

const sheets = google.sheets({
  version: 'v4',
  auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('currentvacations')
        .setDescription('Display all players currently on vacation'),
    
    async execute(interaction) {
        try {
            // Fetch all data from the sheet dynamically
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H`, // Fetches all relevant columns starting from A2
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                return interaction.reply({ content: 'No players found.', ephemeral: true });
            }

            // Element Emojis
            const elementEmojiMap = {
                'Fire': '🔥',
                'Light': '⚡',
                'Cold': '❄️'
            };

            // Find players currently in "Vacation" state
            const vacations = rows.filter(row => row[5] === 'Vacation'); // Check if the "Status" column has "Vacation"
            
            if (vacations.length === 0) {
                return interaction.reply({ content: 'There are currently no players on vacation.', ephemeral: true });
            }

            // Sort players by vacation date (cDate, column 6)
            vacations.sort((a, b) => new Date(a[6]) - new Date(b[6]));

            // Split vacations into pages of 10 players each
            const pages = [];
            for (let i = 0; i < vacations.length; i += 10) {
                const pageVacations = vacations.slice(i, i + 10);
                const vacationEmbed = new EmbedBuilder()
                    .setColor(0xFFCC00)
                    .setTitle('🏝️ Vacation Leaderboard 🏝️')
                    .setDescription('Who is winning the vacation game? ranked by longest time away... *looks off into sunset*☀️')
                    .setTimestamp()
                    .setFooter({ text: 'We hope to see you back soon!', iconURL: interaction.client.user.displayAvatarURL() });

                pageVacations.forEach(player => {
                    const playerRank = player[0]; // Rank of player
                    const playerName = player[1]; // Name of player
                    const playerElement = player[3]; // Element of player
                    const vacationDate = player[6] ? player[6].split(',')[0] : 'Enjoying an indefinite holiday 😎'; // Vacation start date with witty fallback
                    const discordUserName = player[4]; // Discord username

                    vacationEmbed.addFields({
                    name: `Rank #${playerRank}: ${playerName} (${discordUserName})`,
                    value: `Element: ${elementEmojiMap[playerElement]} | Start: ${vacationDate}`,
                    inline: false
                });
                });

                pages.push(vacationEmbed);
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
                    .setDisabled(pages.length <= 1), // Disable if there's only one page
                new ButtonBuilder()
                    .setCustomId('last')
                    .setLabel('Last')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pages.length <= 1) // Disable if there's only one page
            );

            const message = await interaction.reply({
                embeds: [pages[currentPage]],
                components: [buttonRow],
                ephemeral: true
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
                    currentPage = pages.length - 1;
                }

                await buttonInteraction.update({
                    embeds: [pages[currentPage]],
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
                                .setDisabled(currentPage === pages.length - 1),
                            new ButtonBuilder()
                                .setCustomId('last')
                                .setLabel('Last')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(currentPage === pages.length - 1)
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
            logError(`Error fetching current vacations: ${error.message}\nStack: ${error.stack}`);
            await interaction.reply({ content: 'There was an error fetching the players on vacation. Please try again.', ephemeral: true });
        }
    },
};
