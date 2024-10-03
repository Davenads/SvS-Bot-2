require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Initialize the Discord client with the necessary intents
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Load the command handler
require('./handlers/commandHandler')(client);

// Event listener for when the bot becomes ready and online
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Event listener for handling interactions (slash commands)
client.on('interactionCreate', async interaction => {
    // Only proceed if the interaction is a command
    if (!interaction.isCommand()) return;

    // Retrieve the command from the client's command collection
    const command = client.commands.get(interaction.commandName);

    // If the command doesn't exist, ignore it
    if (!command) return;

    // Check if the user has the '@SvS Dueler' role by name
    const duelerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Dueler');
    if (!duelerRole || !interaction.member.roles.cache.has(duelerRole.id)) {
        return interaction.reply({
            content: 'You do not have the required @SvS Dueler role to use this command.',
            ephemeral: true
        });
    }

    try {
        // Execute the command
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        // Respond with an error message if command execution fails
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Login to Discord with your bot token
client.login(process.env.BOT_TOKEN);
