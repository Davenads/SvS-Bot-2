const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');

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
const METRICS_TAB = 'Metrics';
const ENTRIES_PER_PAGE = 10;

// Medal emojis for top 3
const MEDALS = {
    1: '👑', // Crown for #1
    2: '🥈',
    3: '🥉'
};

// Trophy emojis for flair
const TROPHIES = ['🏆', '⚔️', '🛡️', '🎮', '🎯', '✨'];

// Footer messages
const FOOTER_MESSAGES = [
    'Can you make it to the top?',
    'Every defense counts!',
    'Glory awaits the champions!',
    'Defend your title with honor!'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('titledefends')
        .setDescription('Display the leaderboard of successful title defenses'),

    async execute(interaction) {
        console.log(`[${new Date().toISOString()}] Command invoked: /titledefends by ${interaction.user.tag} (${interaction.user.id})`);
        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch title defends data from Metrics tab
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${METRICS_TAB}!A11:C` // Title defends section
            });

            if (!result.data.values) {
                return await interaction.editReply({
                    content: 'No title defense records found.',
                    ephemeral: true
                });
            }

            console.log('├─ Processing data from Metrics tab...');
            // Process and sort the data
            const titleDefends = result.data.values
                .filter(row => row[0] && row[2]) // Filter out empty rows
                .map(row => ({
                    username: row[0],
                    discordId: row[1] ? row[1].trim() : '', // Handle empty or whitespace-only IDs
                    defends: parseInt(row[2])
                }))
                .sort((a, b) => b.defends - a.defends); // Sort by number of defends descending

            console.log(`├─ Found ${titleDefends.length} title defenders`);
            console.log('├─ Creating paginated embeds...');
            // Split data into pages
            const pages = [];
            for (let i = 0; i < titleDefends.length; i += ENTRIES_PER_PAGE) {
                const pageDefenders = titleDefends.slice(i, i + ENTRIES_PER_PAGE);
                let pageText = '';
                
                // Process defenders sequentially with await
                for (const [index, defender] of pageDefenders.entries()) {
                    const position = i + index + 1;
                    const medal = MEDALS[position] || '•';
                    const trophy = position <= 3 ? TROPHIES[Math.floor(Math.random() * TROPHIES.length)] : '';
                    
                    // Check if the discordId exists and if the member is in the guild
                    let memberMention;
                    try {
                        if (defender.discordId) {
                            const member = await interaction.guild.members.fetch(defender.discordId);
                            memberMention = `<@${defender.discordId}>`;
                        } else {
                            throw new Error('No Discord ID provided');
                        }
                    } catch (error) {
                        console.log(`├─ Could not find member for ID ${defender.discordId}, falling back to username: ${defender.username}`);
                        memberMention = `${defender.username}`;
                    }
                    pageText += `${medal} **#${position}** ${memberMention}\n`;
                    pageText += `┗━ ${defender.defends} successful defends ${trophy}\n\n`;
                };

                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏰 Title Defense Leaderboard 🏰')
                    .setDescription('Honoring our most successful title defenders!')
                    .addFields({
                        name: '📊 Defense Records',
                        value: pageText || '*No title defenses recorded yet. Will you be the first?*'
                    })
                    .setTimestamp()
                    .setFooter({
                        text: `Page ${pages.length + 1}/${Math.ceil(titleDefends.length / ENTRIES_PER_PAGE)} • ${FOOTER_MESSAGES[Math.floor(Math.random() * FOOTER_MESSAGES.length)]}`,
                        iconURL: interaction.client.user.displayAvatarURL()
                    });

                pages.push(embed);
            }

            // If no pages were created (no data), create a default page
            if (pages.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🏰 Title Defense Leaderboard 🏰')
                    .setDescription('Honoring our most successful title defenders!')
                    .addFields({
                        name: '📊 Defense Records',
                        value: '*No title defenses recorded yet. Will you be the first?*'
                    })
                    .setTimestamp()
                    .setFooter({
                        text: FOOTER_MESSAGES[Math.floor(Math.random() * FOOTER_MESSAGES.length)],
                        iconURL: interaction.client.user.displayAvatarURL()
                    });
                pages.push(embed);
            }

            // Create navigation buttons
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
                    .setDisabled(pages.length <= 1),
                new ButtonBuilder()
                    .setCustomId('last')
                    .setLabel('Last')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pages.length <= 1)
            );

            // Send initial message with first page
            const message = await interaction.editReply({
                embeds: [pages[currentPage]],
                components: pages.length > 1 ? [buttonRow] : [],
                ephemeral: true
            });

            // Create button collector
            if (pages.length > 1) {
                const collector = message.createMessageComponentCollector({
                    time: 60000 // 60 seconds timeout
                });

                collector.on('collect', async (buttonInteraction) => {
                    switch (buttonInteraction.customId) {
                        case 'first':
                            currentPage = 0;
                            break;
                        case 'previous':
                            currentPage--;
                            break;
                        case 'next':
                            currentPage++;
                            break;
                        case 'last':
                            currentPage = pages.length - 1;
                            break;
                    }

                    // Update button states
                    const updatedRow = new ActionRowBuilder().addComponents(
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
                    );

                    await buttonInteraction.update({
                        embeds: [pages[currentPage]],
                        components: [updatedRow]
                    });
                });

                collector.on('end', () => {
                    // Remove buttons after timeout
                    interaction.editReply({
                        embeds: [pages[currentPage]],
                        components: []
                    });
                });
            }

        } catch (error) {
            console.error('Error in titledefends command:', error);
            logError(`Title defends command error: ${error.message}\nStack: ${error.stack}`);
            
            console.log(`└─ Command completed successfully: ${pages.length} pages created`);
            await interaction.editReply({
                content: 'An error occurred while fetching the title defense leaderboard. Please try again later.',
                ephemeral: true
            });
        }
    },
};