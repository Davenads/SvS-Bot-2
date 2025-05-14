require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
        .setName('currentchallenges')
        .setDescription('Display all current challenges in the ladder'),
    
    async execute(interaction) {
        try {
            // Log who invoked the command
            const user = interaction.user.tag;
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] /currentchallenges command executed by ${user}`);
            
            // Fetch all data from the sheet dynamically
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H`, // Fetches all relevant columns starting from A2
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
                console.log(`[${timestamp}] No challenges found for ${user}'s request`);
                return interaction.reply({ content: 'No challenges found.', ephemeral: true });
            }

            // Element Emojis
            const elementEmojiMap = {
                'Fire': '🔥',
                'Light': '⚡',
                'Cold': '❄️'
            };

            // Find players currently in "Challenge" state
            const challenges = rows.filter(row => row[5] === 'Challenge'); // Check if the "Status" column has "Challenge"
            
            // Log number of challenge pairs found
            console.log(`[${timestamp}] Found ${challenges.length} challenges for ${user}'s request`);
            
            if (challenges.length === 0) {
                return interaction.reply({ content: 'There are currently no active challenges.', ephemeral: true });
            }

            // Track already processed pairs to avoid duplicates
            const processedPairs = new Set();

            // Create an embed to display all current challenges
            const challengeEmbed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('🏆 Current SvS Challenges 🏆')
                .setDescription('Here are the ongoing challenges in the SvS Ladder:')
                .setTimestamp()
                .setFooter({ text: 'Good luck to all challengers!', iconURL: interaction.client.user.displayAvatarURL() });

            // Add each challenge to the embed, avoiding duplicates
            challenges.forEach(challenge => {
                const challengerRank = challenge[0]; // Rank of challenger
                const challengerName = challenge[1]; // Name of challenger
                const challengerElement = challenge[3]; // Element of challenger
                const challengedRank = challenge[7]; // Rank of the challenged
                const challengeDate = challenge[6]; // Challenge date

                const pairKey = `${challengerRank}-${challengedRank}`;
                const reversePairKey = `${challengedRank}-${challengerRank}`;

                // Skip if the reverse pair has already been processed
                if (processedPairs.has(reversePairKey)) {
                    return;
                }

                processedPairs.add(pairKey);

                const challengedPlayer = rows.find(row => row[0] === challengedRank);
                const challengedName = challengedPlayer ? challengedPlayer[1] : 'Unknown';
                const challengedElement = challengedPlayer ? challengedPlayer[3] : 'Unknown';

                // Add a field to the embed with details about the challenge
                challengeEmbed.addFields({
                    name: `Challenge: Rank #${challengerRank} vs Rank #${challengedRank}`,
                    value: `**${challengerName}** ${elementEmojiMap[challengerElement]} 🆚 **${challengedName}** ${elementEmojiMap[challengedElement]}
Challenge Date: ${challengeDate}`,
                    inline: false
                });
            });

            // Log number of unique challenge pairs
            console.log(`[${timestamp}] Displayed ${processedPairs.size} unique challenge pairs to ${user}`);
            
            // Send the embed privately to the user who invoked the command
            await interaction.reply({ embeds: [challengeEmbed], ephemeral: true });

        } catch (error) {
            // Log error with user information
            const errorMsg = `Error fetching current challenges for ${interaction.user.tag}: ${error.message}\nStack: ${error.stack}`;
            logError(errorMsg);
            console.error(`[${new Date().toISOString()}] ${errorMsg}`);
            await interaction.reply({ content: 'There was an error fetching the current challenges. Please try again.', ephemeral: true });
        }
    },
};