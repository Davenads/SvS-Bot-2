// Load environment variables
require('dotenv').config();

// Import necessary modules
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const credentials = require('../config/credentials.json');

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
const sheetId = 0; // Numeric sheetId for 'SvS Ladder' tab

// Define emoji icons for Spec and Element
const specEmojis = {
    'Vita': '❤️',
    'ES': '🔵'
};

const elementEmojis = {
    'Fire': '🔥',
    'Light': '⚡',
    'Cold': '❄️'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register a new character to the ladder')
        .addStringOption(option =>
            option.setName('character_name')
                .setDescription('The name of the character to register')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('spec')
                .setDescription('The character spec (Vita or ES)')
                .setRequired(true)
                .addChoices(
                    { name: 'Vita', value: 'Vita' },
                    { name: 'ES', value: 'ES' }
                ))
        .addStringOption(option =>
            option.setName('element')
                .setDescription('The character element (Fire, Light, or Cold)')
                .setRequired(true)
                .addChoices(
                    { name: 'Fire', value: 'Fire' },
                    { name: 'Light', value: 'Light' },
                    { name: 'Cold', value: 'Cold' }
                ))
        .addStringOption(option =>
            option.setName('disc_user')
                .setDescription('The Discord username of the character owner')
                .setRequired(true)
                .setAutocomplete(true)) // Enable dynamic autocomplete for Discord username
        .addStringOption(option =>
            option.setName('notes')
                .setDescription('Optional notes for the character')
                .setRequired(false)),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        if (focusedOption.name === 'disc_user') {
            try {
                // Fetch all members with the 'SvS Dueler' role
                const guild = interaction.guild;
                const duelerRole = guild.roles.cache.find(role => role.name === 'SvS Dueler');
                if (!duelerRole) return interaction.respond([]);

                const members = await guild.members.fetch();
                const eligibleMembers = members.filter(member => member.roles.cache.has(duelerRole.id));

                const choices = eligibleMembers.map(member => member.user.username);
                const filtered = choices.filter(choice => choice.toLowerCase().includes(focusedOption.value.toLowerCase())).slice(0, 25); // Limit choices to 25

                await interaction.respond(
                    filtered.map(choice => ({ name: choice, value: choice }))
                );
            } catch (error) {
                console.error('Error fetching autocomplete options:', error);
                await interaction.respond([]);
            }
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }); // Defer the reply to prevent timeout issues

        // Check if the user has the '@SvS Manager' role
        const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
        if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
            return interaction.editReply({
                content: 'You do not have the required @SvS Manager role to use this command.',
                ephemeral: true
            });
        }

        // Retrieve command options
        const characterName = interaction.options.getString('character_name');
        const spec = interaction.options.getString('spec');
        const element = interaction.options.getString('element');
        const discUser = interaction.options.getString('disc_user');
        const discUserId = interaction.guild.members.cache.find(member => member.user.username === discUser)?.id;
        const notes = interaction.options.getString('notes') || '';

        if (!discUserId) {
            return interaction.editReply({ content: 'Could not find the specified Discord user.', ephemeral: true });
        }

        try {
            // Fetch data from the Google Sheet (Main Tab: 'SvS Ladder')
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`, // Fetch columns A to K
            });

            const rows = result.data.values;
            // Find the first empty row based on the Name column (Column B)
            let emptyRowIndex = rows.length + 2; // Default to appending at the end
            for (let i = 0; i < rows.length; i++) {
                if (!rows[i][1]) { // Check if Column B (Name) is empty
                    emptyRowIndex = i + 2;
                    break;
                }
            }

            const newCharacterRow = [
                emptyRowIndex - 1, // Rank (new entry based on available position)
                characterName, // Name
                spec, // Spec
                element, // Element
                discUser, // Discord username
                'Available', // Status
                '', // cDate
                '', // Opp#
                discUserId, // Discord user ID
                notes, // Notes
                '' // Cooldown
            ];

            // Create requests for copying formatting from an existing row
            const copyRowIndex = 1; // Assuming row 2 (index 1) has the desired formatting for Spec, Element, and Status columns
            const requests = [
                {
                    copyPaste: {
                        source: {
                            sheetId: sheetId,
                            startRowIndex: copyRowIndex,
                            endRowIndex: copyRowIndex + 1,
                            startColumnIndex: 2,
                            endColumnIndex: 6
                        },
                        destination: {
                            sheetId: sheetId,
                            startRowIndex: emptyRowIndex - 1,
                            endRowIndex: emptyRowIndex,
                            startColumnIndex: 2,
                            endColumnIndex: 6
                        },
                        pasteType: 'PASTE_FORMAT'
                    }
                },
                {
                    copyPaste: {
                        source: {
                            sheetId: sheetId,
                            startRowIndex: copyRowIndex,
                            endRowIndex: copyRowIndex + 1,
                            startColumnIndex: 5,
                            endColumnIndex: 6
                        },
                        destination: {
                            sheetId: sheetId,
                            startRowIndex: emptyRowIndex - 1,
                            endRowIndex: emptyRowIndex,
                            startColumnIndex: 5,
                            endColumnIndex: 6
                        },
                        pasteType: 'PASTE_DATA_VALIDATION'
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: emptyRowIndex - 1,
                            endRowIndex: emptyRowIndex,
                            startColumnIndex: 3, // Element column (D)
                            endColumnIndex: 4
                        },
                        rows: [{
                            values: [{
                                userEnteredFormat: {
                                    backgroundColor: element === 'Cold' ? { red: 0.5, green: 0.635, blue: 1 } :
                                                    element === 'Fire' ? { red: 0.976, green: 0.588, blue: 0.51 } :
                                                    { red: 1, green: 0.929, blue: 0.686 }
                                }
                            }]
                        }],
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                },
                {
                    updateCells: {
                        range: {
                            sheetId: sheetId,
                            startRowIndex: emptyRowIndex - 1,
                            endRowIndex: emptyRowIndex,
                            startColumnIndex: 1, // Name column (B)
                            endColumnIndex: 2
                        },
                        rows: [{
                            values: [{
                                userEnteredFormat: {
                                    textFormat: {
                                        bold: true
                                    }
                                }
                            }]
                        }],
                        fields: 'userEnteredFormat.textFormat.bold'
                    }
                }
            ];

            // Execute batch update for copying formatting, data validation, and custom styling
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests }
            });

            // Update the Google Sheet with the new row at the correct position
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A${emptyRowIndex}:K`,
                valueInputOption: 'RAW',
                resource: {
                    values: [newCharacterRow]
                }
            });

            // Ensure the Status column (Column F) is set to 'Available' after copying data validation
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!F${emptyRowIndex}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [['Available']]
                }
            });

            // Create an embed to display the registration details
            const embed = new EmbedBuilder()
                .setColor('#FFA500') // Aesthetic color for the embed
                .setTitle('✨ New Character Registered! ✨')
                .setThumbnail('https://example.com/character_image.png') // Add an appealing thumbnail image
                .addFields(
                    { name: '📝 **Character Name**', value: `**${characterName}**`, inline: false },
                    { name: '👤 **Discord User**', value: `**${discUser}**`, inline: false },
                    { name: '⚔️ **Spec & Element**', value: `${specEmojis[spec]} **${spec}** / ${elementEmojis[element]} **${element}**`, inline: false },
                    { name: '📜 **Notes**', value: notes ? `**${notes}**` : 'None', inline: false }
                )
                .setImage('https://example.com/flair_banner.png') // Add a banner image for flair
                .setFooter({ text: 'Successfully added to the SvS Ladder!', iconURL: 'https://example.com/footer_icon.png' })
                .setTimestamp();

            // Reply with the embed
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error registering new character:', error);
            return interaction.editReply({ content: 'An error occurred while registering the character. Please try again later.', ephemeral: true });
        }
    },
};