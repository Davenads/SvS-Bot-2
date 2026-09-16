// Load environment variables
require('dotenv').config();

// Import necessary modules
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');
const { getGoogleAuth } = require('../fixGoogleAuth');
const { getLadderByKey } = require('../utils/ladder');

// Initialize the Google Sheets API client
const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dodge')
        .setDescription('Increment dodge count for a player')
        .addIntegerOption(option =>
            option
                .setName('rank')
                .setDescription('The rank of the player who dodged')
                .setRequired(true)),

    async execute(interaction) {
        // Check if user has SvS Manager role
        if (!interaction.member.roles.cache.some(role => role.name === 'SvS Manager')) {
            return interaction.reply({
                content: 'You need the SvS Manager role to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        // Resolve the ladder (default: main). Phase 2 will read this from the
        // optional `ladder` option; for now it is pinned to main.
        const ladder = getLadderByKey('main');

        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] Dodge Command`);
        console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);
        console.log(`├─ Channel: #${interaction.channel.name} (${interaction.channel.id})`);
        console.log(`├─ Guild: ${interaction.guild.name} (${interaction.guild.id})`);

        const playerRank = interaction.options.getInteger('rank');
        console.log(`├─ Player Rank: ${playerRank}`);

        try {
            // Fetch data from Google Sheet
            console.log('├─ Fetching data from Google Sheets...');
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ladder.sheetName}!A2:K`
            });

            const rows = result.data.values;
            if (!rows?.length) {
                console.log('└─ Error: No data found in leaderboard');
                return interaction.editReply({
                    content: 'No data available on the leaderboard.'
                });
            }

            // Find the player row by rank
            const playerRowIndex = rows.findIndex(row => parseInt(row[0]) === playerRank);
            if (playerRowIndex === -1) {
                console.log('└─ Error: Player with specified rank not found');
                return interaction.editReply({ 
                    content: `No player found with rank ${playerRank}.` 
                });
            }

            const playerRow = rows[playerRowIndex];
            const playerName = playerRow[1];
            
            // Get current dodge count from column K (index 10)
            let currentDodges = playerRow[10] || '';
            
            // If empty or not a number, start at 0
            let dodgeCount = 0;
            if (currentDodges && !isNaN(currentDodges)) {
                dodgeCount = parseInt(currentDodges);
            }
            
            // Increment dodge count
            dodgeCount++;
            
            // Update the Google Sheet
            console.log(`├─ Updating dodge count for ${playerName} (Rank ${playerRank}) from ${currentDodges} to ${dodgeCount}`);
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${ladder.sheetName}!K${playerRowIndex + 2}`,  // +2 because row index starts at 0 and sheet has header
                valueInputOption: 'RAW',
                resource: {
                    values: [[dodgeCount.toString()]]
                }
            });

            // Create response embed
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🏃 Dodge Recorded')
                .setDescription(`Updated dodge count for **${playerName}** (Rank ${playerRank})`)
                .addFields(
                    { name: 'New Dodge Count', value: `**${dodgeCount}**`, inline: true }
                )
                .setFooter({ 
                    text: `Recorded by ${interaction.user.username}`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            // Send response
            await interaction.editReply({ embeds: [embed] });
            console.log('└─ Command completed successfully');
            
        } catch (error) {
            console.error(`└─ Error: ${error.message}`);
            logError('Error in dodge command', error);
            return interaction.editReply({
                content: 'An error occurred while recording the dodge. Please try again later.'
            });
        }
    },
};