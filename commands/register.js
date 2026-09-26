// Load environment variables
require('dotenv').config();

// Import necessary modules
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLadderFromOption } = require('../utils/ladder');
const { writeNewCharacter } = require('../services/registrationService');

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
                .setRequired(false))
        .addStringOption(option =>
            option.setName('ladder')
                .setDescription('Which ladder (defaults to HLD)')
                .setRequired(false)
                .addChoices(
                    { name: 'HLD', value: 'main' },
                    { name: 'LLD', value: 'lld' }
                )),

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
        await interaction.deferReply(); // Defer the reply to prevent timeout issues

        // Resolve the ladder from the optional `ladder` option (default: main).
        const ladder = getLadderFromOption(interaction);

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
            // Shared write core (same path the self-serve Sign Up wizard uses):
            // finds the first empty row, copies formatting + data validation,
            // paints the element background, bolds the name, forces status
            // Available, and refreshes the rankings board.
            await writeNewCharacter(interaction.client, ladder, {
                characterName,
                spec,
                element,
                discUser,
                discUserId,
                notes
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

            // Reply with the embed (writeNewCharacter already refreshed the board).
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error registering new character:', error);
            return interaction.editReply({ content: 'An error occurred while registering the character. Please try again later.', ephemeral: true });
        }
    },
};