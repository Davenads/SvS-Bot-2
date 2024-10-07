// Load environment variables
require('dotenv').config();

// Import necessary modules
const { SlashCommandBuilder } = require('discord.js');
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
                .setRequired(true))
        .addStringOption(option =>
            option.setName('notes')
                .setDescription('Optional notes for the character')
                .setRequired(false)),
    
    async execute(interaction) {
        // Check if the user has the '@SvS Manager' role
        const managerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Manager');
        if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
            return interaction.reply({
                content: 'You do not have the required @SvS Manager role to use this command.',
                ephemeral: true
            });
        }

        // Retrieve command options
        const characterName = interaction.options.getString('character_name');
        const spec = interaction.options.getString('spec');
        const element = interaction.options.getString('element');
        const discUser = interaction.options.getString('disc_user');
        const discUserId = interaction.user.id;
        const notes = interaction.options.getString('notes') || '';

        try {
            // Fetch data from the Google Sheet (Main Tab: 'SvS Ladder')
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A2:K`,  // Fetch columns A to K
            });

            const rows = result.data.values;
            // Calculate ladder length only once
            const ladderLength = rows.filter(row => row[0] && !isNaN(parseInt(row[0]))).length;
            const newCharacterRow = [
                ladderLength + 1, // Rank (new entry at the bottom of the ladder)
                characterName,   // Name
                spec,            // Spec
                element,         // Element
                discUser,        // Discord username
                'Available',     // Status
                '',              // cDate
                '',              // Opp#
                discUserId,      // Discord user ID
                notes,           // Notes
                ''               // Cooldown
            ];

            // Append the new row to the Google Sheet at the correct ladder position
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `SvS Ladder!A${ladderLength + 2}:K`,
                valueInputOption: 'RAW',
                resource: {
                    values: [newCharacterRow]
                }
            });

            return interaction.reply({ content: `Character '${characterName}' has been successfully registered to the ladder!`, ephemeral: true });
        } catch (error) {
            console.error('Error registering new character:', error);
            return interaction.reply({ content: 'An error occurred while registering the character. Please try again later.', ephemeral: true });
        }
    },
};