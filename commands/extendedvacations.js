require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');

// Initialize Google Sheets API client
const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  )
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Extended Vacation';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('extendedvacations')
        .setDescription('Displays players on extended vacation from the SvS ladder'),
    
    async execute(interaction) {
        console.log(`[${new Date().toISOString()}] Command invoked: /extendedvacations by ${interaction.user.tag} (${interaction.user.id})`);
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
                range: `${SHEET_NAME}!A2:H`,
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                return await interaction.editReply({ content: 'No players currently on extended vacation.' });
            }

            const validRows = rows.filter(row => row[0] && row[1]); // Filter out rows with missing rank or name

            if (!validRows.length) {
                return await interaction.editReply({ content: 'No valid data available in the extended vacation list.' });
            }

            const embeds = [];
            let currentEmbed = new EmbedBuilder()
                .setColor(0xFFD700) // Gold color for vacation theme
                .setTitle('🏖️ Extended Vacation Paradise 🌴')
                .setDescription('Players taking a break from the SvS Ladder, enjoying their well-deserved vacation!')
                .setTimestamp()
                .setFooter({ text: 'Missing our champions...', iconURL: interaction.client.user.displayAvatarURL() });

            // Emojis for Element and Spec
            const elementEmojiMap = {
                Fire: '🔥',
                Light: '⚡',
                Cold: '❄️'
            };

            const specEmojiMap = {
                'Vita': '❤️',
                'ES': '🟠'
            };

            // Process rows into multiple embeds if necessary
            validRows.forEach((row, index) => {
                const rank = row[0] || 'N/A';
                const name = row[1] || 'Unknown';
                const spec = row[2] || 'Unknown';
                const element = row[3] || 'Unknown';
                const discordUser = row[4] || 'Unknown';

                // Consolidating spec and element into one line with the player's name
                const specEmoji = specEmojiMap[spec] || '';
                const elementEmoji = elementEmojiMap[element] || '';

                currentEmbed.addFields({
                    name: `🌺 ${name}`,
                    value: `Former Rank: #${rank}
${specEmoji} ${spec} | ${elementEmoji} ${element}
Discord: ${discordUser}`,
                    inline: false
                });

                // If the current embed has reached 10 fields, push it to the array and create a new embed
                if ((index + 1) % 10 === 0 || index === validRows.length - 1) {
                    embeds.push(currentEmbed);
                    currentEmbed = new EmbedBuilder()
                        .setColor(0xFFD700)
                        .setTitle('🏖️ Extended Vacation Paradise (continued) 🌴')
                        .setTimestamp()
                        .setFooter({ text: 'Missing our champions...', iconURL: interaction.client.user.displayAvatarURL() });
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
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(embeds.length <= 1),
                new ButtonBuilder()
                    .setCustomId('last')
                    .setLabel('Last')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(embeds.length <= 1)
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
            console.error(`Error during extended vacations execution: ${error.message}`);
            await deferIfNecessary();
            await interaction.editReply({ content: 'There was an error retrieving the extended vacation data.' });
        }
    },
};