const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger');

// Initialize the Google Sheets API client
const sheets = google.sheets({
    version: 'v4',
    auth: new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key.replace(/\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets']
    ),
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const sheetId = 0;

// Emoji mappings
const elementEmojis = {
    'Fire': '🔥',
    'Light': '⚡',
    'Cold': '❄️'
};

const specEmojis = {
    'Vita': '❤️',
    'ES': '🟠'
};

const farewellMessages = [
    "May your adventures continue beyond the ladder! 🌟",
    "Your legacy in the ladder will be remembered! ⚔️",
    "Until we meet again, brave warrior! 👋",
    "The ladder will miss your presence! 🎭",
    "Your chapter in our story may end, but your legend lives on! 📖",
    "Farewell, noble challenger! 🏰",
    "May your future battles be glorious! ⚔️",
    "Your name shall echo in the halls of the ladder! 🏛️"
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a player from the ladder')
        .addIntegerOption(option =>
            option.setName('rank')
                .setDescription('The rank number of the player to remove')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Log command invocation
        console.log(`\n[${new Date().toISOString()}] Remove Command`);
        console.log(`├─ Invoked by: ${interaction.user.tag}`);

        await interaction.deferReply({ ephemeral: true });

        // Check if the user has the '@SvS Manager' role
        const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
        if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
            return interaction.editReply({
                content: 'You do not have the required @SvS Manager role to use this command.',
                ephemeral: true
            });
        }

        try {
            const rankToRemove = interaction.options.getInteger('rank');

            // Fetch all data from the sheet
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`,
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                console.log('└─ Error: No data found in leaderboard');
                return interaction.editReply({
                    content: 'No data available on the leaderboard.',
                    ephemeral: true
                });
            }

            // Find the row index and player data
            const rowIndex = rows.findIndex(row => row[0] && parseInt(row[0]) === rankToRemove);
            if (rowIndex === -1) {
                console.log(`└─ Error: Rank ${rankToRemove} not found`);
                return interaction.editReply({
                    content: 'Rank not found in the ladder.',
                    ephemeral: true
                });
            }

            // Store player details
            const playerData = rows[rowIndex];
            const playerName = playerData[1];
            const playerSpec = playerData[2];
            const playerElement = playerData[3];
            const discordUsername = playerData[4];
            const discordId = playerData[8];

            // Log removal details
            console.log('├─ Removing Player:');
            console.log(`│  ├─ Rank: #${rankToRemove}`);
            console.log(`│  └─ Discord: ${discordUsername}`);

            const requests = [];

            // 1. Handle active challenges with the player being removed
            if (playerData[5] === 'Challenge' && playerData[7]) {
                const opponentRank = parseInt(playerData[7]);
                const opponentIndex = rows.findIndex(row => row[0] && parseInt(row[0]) === opponentRank);
                
                if (opponentIndex !== -1) {
                    console.log(`├─ Clearing challenge with rank #${opponentRank}`);
                    requests.push({
                        updateCells: {
                            range: {
                                sheetId: sheetId,
                                startRowIndex: opponentIndex + 1,
                                endRowIndex: opponentIndex + 2,
                                startColumnIndex: 5,
                                endColumnIndex: 8
                            },
                            rows: [{
                                values: [
                                    { userEnteredValue: { stringValue: 'Available' } },
                                    { userEnteredValue: { stringValue: '' } },
                                    { userEnteredValue: { stringValue: '' } }
                                ]
                            }],
                            fields: 'userEnteredValue'
                        }
                    });
                }
            }

            // 2. Delete the row
            requests.push({
                deleteDimension: {
                    range: {
                        sheetId: sheetId,
                        dimension: 'ROWS',
                        startIndex: rowIndex + 1,
                        endIndex: rowIndex + 2
                    }
                }
            });

            // 3. Update ranks and opponent references
            let ranksUpdated = 0;
            for (let i = rowIndex + 1; i < rows.length; i++) {
                const currentRow = rows[i];
                if (!currentRow[0]) continue;

                const currentRank = parseInt(currentRow[0]);
                const newRank = currentRank - 1;
                ranksUpdated++;

                requests.push({
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: i,
                            endRowIndex: i + 1,
                            startColumnIndex: 0,
                            endColumnIndex: 1
                        },
                        rows: [{
                            values: [{
                                userEnteredValue: { stringValue: newRank.toString() },
                                userEnteredFormat: { horizontalAlignment: 'RIGHT' }
                            }]
                        }],
                        fields: 'userEnteredValue,userEnteredFormat.horizontalAlignment'
                    }
                });

                if (currentRow[5] === 'Challenge' && currentRow[7]) {
                    const oppRank = parseInt(currentRow[7]);
                    
                    if (oppRank > rankToRemove) {
                        console.log(`├─ Updating opponent reference: Rank #${currentRank} -> #${newRank}`);
                        requests.push({
                            updateCells: {
                                range: {
                                    sheetId: sheetId,
                                    startRowIndex: i,
                                    endRowIndex: i + 1,
                                    startColumnIndex: 7,
                                    endColumnIndex: 8
                                },
                                rows: [{
                                    values: [{
                                        userEnteredValue: { stringValue: (oppRank - 1).toString() }
                                    }]
                                }],
                                fields: 'userEnteredValue'
                            }
                        });
                    } else if (oppRank === rankToRemove) {
                        console.log(`├─ Resetting challenge status for rank #${currentRank}`);
                        requests.push({
                            updateCells: {
                                range: {
                                    sheetId: sheetId,
                                    startRowIndex: i,
                                    endRowIndex: i + 1,
                                    startColumnIndex: 5,
                                    endColumnIndex: 8
                                },
                                rows: [{
                                    values: [
                                        { userEnteredValue: { stringValue: 'Available' } },
                                        { userEnteredValue: { stringValue: '' } },
                                        { userEnteredValue: { stringValue: '' } }
                                    ]
                                }],
                                fields: 'userEnteredValue'
                            }
                        });
                    }
                }
            }

            console.log(`├─ Updated ${ranksUpdated} ranks`);

            // Execute updates
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests }
            });

            // Verify ranks
            const verificationResult = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:A`,
            });

            const updatedRanks = verificationResult.data.values;
            let ranksAreCorrect = true;
            let firstIncorrectRank = null;

            if (updatedRanks) {
                for (let i = 0; i < updatedRanks.length; i++) {
                    if (updatedRanks[i][0] && parseInt(updatedRanks[i][0]) !== i + 1) {
                        ranksAreCorrect = false;
                        firstIncorrectRank = i + 1;
                        break;
                    }
                }
            }

            console.log(`└─ Rank verification: ${ranksAreCorrect ? 'Success' : 'Failed'}`);

            // Create farewell embed
            const farewellEmbed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('👋 Farewell from the Ladder!')
                .setDescription(farewellMessages[Math.floor(Math.random() * farewellMessages.length)])
                .addFields(
                    { 
                        name: '🎭 Character',
                        value: `**${playerName}** (Rank #${rankToRemove})`,
                        inline: true 
                    },
                    { 
                        name: '⚔️ Build',
                        value: `${specEmojis[playerSpec] || ''} ${playerSpec} ${elementEmojis[playerElement] || ''} ${playerElement}`,
                        inline: true 
                    },
                    { 
                        name: '👤 Discord',
                        value: discordId ? `<@${discordId}>` : discordUsername,
                        inline: true 
                    }
                )
                .setFooter({ 
                    text: `${ranksAreCorrect ? 'All ladder ranks have been updated successfully!' : 'Player removed, but rank verification needed.'}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            // Send embed
            await interaction.channel.send({ embeds: [farewellEmbed] });

            // Send confirmation
            await interaction.editReply({
                content: `Successfully removed ${playerName} from the ladder and updated all affected rankings and challenges.`,
                ephemeral: true
            });

        } catch (error) {
            console.error(`└─ Error: ${error.message}`);
            logError(`Error removing player: ${error.message}\nStack: ${error.stack}`);
            return interaction.editReply({
                content: 'An error occurred while removing the player. Please try again later.',
                ephemeral: true
            });
        }
    },
};