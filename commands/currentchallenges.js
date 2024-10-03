require('dotenv').config();
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');
const { logError } = require('../logger'); // Import the logger

const sheets = google.sheets({ version: 'v4', auth: new google.auth.JWT(
    credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']
)});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('currentchallenges')
        .setDescription('Display all current challenges in the ladder'),
    
    async execute(interaction) {
        try {
            // Fetch all data from the sheet dynamically
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A2:H`, // Fetches all relevant columns starting from A2
            });

            const rows = result.data.values;
            if (!rows || !rows.length) {
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
            
            if (challenges.length === 0) {
                return interaction.reply({ content: 'There are currently no active challenges.', ephemeral: true });
            }

            // Create an embed to display all current challenges
            const challengeEmbed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('🏆 Current SvS Challenges 🏆')
                .setDescription('Here are the ongoing challenges in the SvS Ladder:')
                .setTimestamp()
                .setFooter({ text: 'Good luck to all challengers!', iconURL: interaction.client.user.displayAvatarURL() });

            // Add each challenge to the embed
            challenges.forEach(challenge => {
                const challengerRank = challenge[0]; // Rank of challenger
                const challengerName = challenge[1]; // Name of challenger
                const challengerElement = challenge[3]; // Element of challenger
                const challengedRank = challenge[7]; // Rank of the challenged
                const challengeDate = challenge[6]; // Challenge date

                const challengedPlayer = rows.find(row => row[0] === challengedRank);
                const challengedName = challengedPlayer ? challengedPlayer[1] : 'Unknown';
                const challengedElement = challengedPlayer ? challengedPlayer[3] : 'Unknown';

                // Add a field to the embed with details about the challenge
                challengeEmbed.addFields({
                    name: `Challenge: Rank #${challengerRank} vs Rank #${challengedRank}`,
                    value: `**${challengerName}** ${elementEmojiMap[challengerElement]} 🆚 **${challengedName}** ${elementEmojiMap[challengedElement]}\nChallenge Date: ${challengeDate}`,
                    inline: false
                });
            });

            // Send the embed to the channel
            await interaction.reply({ embeds: [challengeEmbed] });

        } catch (error) {
            logError(`Error fetching current challenges: ${error.message}\nStack: ${error.stack}`);
            await interaction.reply({ content: 'There was an error fetching the current challenges. Please try again.', ephemeral: true });
        }
    },
};
