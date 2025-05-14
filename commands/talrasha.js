require('dotenv').config();

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const { getGoogleAuth } = require('../fixGoogleAuth');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
  });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const sheetName = 'Tal Rasha Signups';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('talrasha')
        .setDescription('Sign up for the Tal Rasha tournament')
        .addStringOption(option =>
            option.setName('character_name')
                .setDescription('The name of the character to register')
                .setRequired(true))
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
            option.setName('notes')
                .setDescription('Optional notes for the character')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const characterName = interaction.options.getString('character_name');
        const element = interaction.options.getString('element');
        const elementEmojis = {
            'Fire': '🔥',
            'Light': '⚡',
            'Cold': '❄️'
        };
        const discUser = interaction.user.username;
        const discUserId = interaction.user.id;
        const notes = interaction.options.getString('notes') || '';

        console.log(`Signing up user: ${discUser} (ID: ${discUserId})`);
        console.log(`Character Name: ${characterName}, Element: ${element}, Notes: ${notes}`);

        try {
            const result = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:E`,
            });

            console.log('Fetched data from Google Sheet:', result.data.values);

            const rows = result.data.values || [];

            // Check if the user has already signed up
            let userAlreadySignedUp = false;
            let existingRowIndex = -1;
            let existingElement = '';
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][2] === discUserId) {
                    userAlreadySignedUp = true;
                    existingRowIndex = i + 2;
                    existingElement = rows[i][3];
                    break;
                }
            }

            if (userAlreadySignedUp) {
                if (existingElement === element) {
                    console.log('User attempted to sign up with the same element. No changes needed.');

                    const embed = new EmbedBuilder()
                .setColor('#8A2BE2')
                .setThumbnail('https://i.imgur.com/TTEhrre.png')
                        .setTitle('🔄 No Changes Needed 🔄')
                        .setDescription(`You attempted to sign up with the same element: **${element}**. No updates were made.`)
                        .addFields(
                            { name: '📝 **Character Name**', value: `**${characterName}**`, inline: false },
                            { name: '👤 **Discord User**', value: `**${discUser}**`, inline: false },
                            { name: '⚔️ **Element**', value: `${elementEmojis[element]} **${element}**`, inline: false }
                        )
                        .setFooter({ text: 'No changes were required for your signup.', iconURL: 'https://example.com/footer_icon.png' })
                        .setTimestamp();

                    return interaction.editReply({ embeds: [embed] });
                }

                // Update the existing signup with the new element and character name
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${sheetName}!A${existingRowIndex}:D${existingRowIndex}`,
                    valueInputOption: 'RAW',
                    resource: {
                        values: [[characterName, discUser, discUserId, element]]
                    }
                });

                console.log('Successfully updated existing signup with new element.');

                const embed = new EmbedBuilder()
                .setColor('#8A2BE2')
                .setThumbnail('https://i.imgur.com/TTEhrre.png')
                    .setTitle('✨ Tal Rasha Tournament Signup Updated ✨')
                    .setDescription(`Your signup has been updated with the new element: **${element}**.`)
                    .addFields(
                        { name: '📝 **Character Name**', value: `**${characterName}**`, inline: false },
                        { name: '👤 **Discord User**', value: `**${discUser}**`, inline: false },
                        { name: '⚔️ **Element**', value: `${elementEmojis[element]} **${element}**`, inline: false },
                        { name: '📜 **Notes**', value: notes ? `**${notes}**` : 'None', inline: false }
                    )
                    .setFooter({ text: 'Your signup details have been updated!', iconURL: 'https://example.com/footer_icon.png' })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            let emptyRowIndex = rows.length + 2;
            for (let i = 0; i < rows.length; i++) {
                if (!rows[i][0]) {
                    emptyRowIndex = i + 2;
                    break;
                }
            }

            console.log(`Inserting new signup at row index: ${emptyRowIndex}`);

            const newSignupRow = [
                characterName,
                discUser,
                discUserId,
                element,
                notes
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A${emptyRowIndex}:E`,
                valueInputOption: 'RAW',
                resource: {
                    values: [newSignupRow]
                }
            });

            console.log('Successfully updated Google Sheet with new signup.');

            const embed = new EmbedBuilder()
                .setColor('#8A2BE2')
                .setThumbnail('https://i.imgur.com/TTEhrre.png')
                .setTitle('✨ Tal Rasha Tournament Signup ✨')
                .addFields(
                    { name: '📝 **Character Name**', value: `**${characterName}**`, inline: false },
                    { name: '👤 **Discord User**', value: `**${discUser}**`, inline: false },
                    { name: '⚔️ **Element**', value: `${elementEmojis[element]} **${element}**`, inline: false },
                    { name: '📜 **Notes**', value: notes ? `**${notes}**` : 'None', inline: false }
                )
                .setFooter({ text: 'Successfully signed up for the Tal Rasha Tournament!', iconURL: 'https://example.com/footer_icon.png' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error signing up for Tal Rasha tournament:', error);
            return interaction.editReply({ content: 'An error occurred while signing up. Please try again later.', ephemeral: true });
        }
    },
};
