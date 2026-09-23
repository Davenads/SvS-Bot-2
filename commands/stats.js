const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');
const redisClient = require('../redis-client');
const { getLadderFromOption } = require('../utils/ladder');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
  });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Element emojis for formatting
const elementEmojis = {
    'Fire': '🔥',
    'Light': '⚡',
    'Cold': '❄️'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Display current ladder statistics and metrics')
        .addStringOption(option =>
            option.setName('ladder')
                .setDescription('Which ladder (defaults to HLD)')
                .setRequired(false)
                .addChoices(
                    { name: 'HLD', value: 'main' },
                    { name: 'LLD', value: 'lld' }
                )),

    async execute(interaction) {
        console.log(`[${new Date().toISOString()}] Command invoked: /stats by ${interaction.user.tag} (${interaction.user.id})`);
        let deferred = false;
        const deferIfNecessary = async () => {
            if (!deferred) {
                await interaction.deferReply({ ephemeral: true });
                deferred = true;
            }
        };
        await deferIfNecessary();

        // Resolve the ladder from the optional `ladder` option (default: main).
        const ladder = getLadderFromOption(interaction);

        try {
            console.log('├─ Fetching metrics and title defense data...');
            // Fetch both metrics and title defends data
            const [metricsResult, titleDefendsResult, currentSeason] = await Promise.all([
                sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${ladder.metricsTab}!A1:F8`
                }),
                sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${ladder.metricsTab}!A11:D` // Title defends section (C=season, D=all-time)
                }),
                redisClient.getSeason(ladder)
            ]);
            const seasonLabel = currentSeason != null ? `Season ${currentSeason}` : 'Current Season';

            if (!metricsResult.data.values) {
                return await interaction.editReply({
                    content: 'No statistics available at the moment.',
                    ephemeral: true
                });
            }

            console.log('├─ Processing element distribution...');
            // Parse element distribution
            const elementData = metricsResult.data.values.slice(2, 6)
                .filter(row => row[0] !== 'Total')
                .map(row => ({
                    element: row[0],
                    count: parseInt(row[1]),
                    percentage: row[2]
                }));

            // Parse player stats
            const playerStats = metricsResult.data.values.slice(2, 7)
                .filter(row => row[4])
                .reduce((acc, row) => {
                    acc[row[4]] = row[5];
                    return acc;
                }, {});

            // Parse and sort title defends (C = current season, D = all-time)
            const titleDefends = (titleDefendsResult.data.values || [])
                .filter(row => row[0]) // Filter out empty rows
                .map(row => ({
                    username: row[0],
                    defends: parseInt(row[2] || '0'),
                    allTime: parseInt(row[3] || '0')
                }))
                .filter(d => d.defends > 0 || d.allTime > 0)
                .sort((a, b) => b.defends - a.defends || b.allTime - a.allTime); // Sort by season, then all-time

            // Create element distribution string
            const elementDistribution = elementData
                .map(elem => `${elementEmojis[elem.element]} ${elem.element}: ${elem.count} (${elem.percentage})`)
                .join('\n');

            // Create title defends string (season defends + all-time in parentheses)
            const titleDefendsString = titleDefends
                .map((defender, index) => `${index + 1}. ${defender.username}: ${defender.defends} this season (${defender.allTime} all-time)`)
                .join('\n');

            // Create embeds array for pagination
            const embeds = [];
            
            // First page: Stats and Element Distribution
            const statsEmbed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle(`📊 ${ladder.displayName} Statistics — ${seasonLabel}`)
                .addFields(
                    {
                        name: '🎭 Player Stats',
                        value: `👥 Total Characters: ${playerStats['Total Characters']}\n` +
                               `👤 Unique Players: ${playerStats['Unique Players']}\n` +
                               `👥 Multi-char Players: ${playerStats['Multi-char Players']}\n` +
                               `⚔️ Active Challenges: ${playerStats['Active Challenges']}\n` +
                               `🏖️ Vacation Count: ${playerStats['Vacation Count']}`,
                        inline: true
                    },
                    {
                        name: '⚡ Element Distribution',
                        value: elementDistribution,
                        inline: true
                    }
                )
                .setFooter({ 
                    text: 'Page 1/2 - General Statistics',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            // Second page: Title Defends
            const titleDefendsEmbed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle(`👑 Title Defense Leaderboard — ${seasonLabel}`)
                .setDescription(titleDefendsString || 'No title defenses recorded yet.')
                .setFooter({ 
                    text: 'Page 2/2 - Title Defenses',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            embeds.push(statsEmbed, titleDefendsEmbed);

            // Create navigation buttons
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
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('last')
                    .setLabel('Last')
                    .setStyle(ButtonStyle.Primary)
            );

            let currentPage = 0;

            console.log('├─ Creating initial embed response...');
            const message = await interaction.editReply({
                embeds: [embeds[currentPage]],
                components: [buttonRow],
                ephemeral: true
            });

            // Create button collector
            const collector = message.createMessageComponentCollector({
                time: 60000 // 60 seconds
            });

            console.log('├─ Setting up button collector...');
            collector.on('collect', async (buttonInteraction) => {
                console.log(`│  ├─ Button clicked: ${buttonInteraction.customId} by ${buttonInteraction.user.tag}`);
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
                        currentPage = embeds.length - 1;
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
                        .setDisabled(currentPage === embeds.length - 1),
                    new ButtonBuilder()
                        .setCustomId('last')
                        .setLabel('Last')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === embeds.length - 1)
                );

                await buttonInteraction.update({
                    embeds: [embeds[currentPage]],
                    components: [updatedRow]
                });
            });

            collector.on('end', () => {
                console.log('└─ Button collector ended');
                interaction.editReply({
                    embeds: [embeds[currentPage]],
                    components: [] // Remove buttons when collector expires
                });
            });

        } catch (error) {
            console.error(`└─ Error during stats execution: ${error.message}`);
            console.error(`Detailed error: ${error.message}`);
            await interaction.editReply({
                content: 'An error occurred while fetching statistics. Please try again later.',
                ephemeral: true
            });
        }
    },
};