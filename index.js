require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { initializeChallengeExpiryHandler, runSafetyCheck } = require('./challenge-expiry-handler');

// Initialize the Discord client with the necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // Added GuildMembers intent for autocomplete
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // Added MessageContent intent to ensure autocomplete works correctly
    ]
});

// Create a collection to store commands
client.commands = new Collection();

// Load the command handler
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.data.name, command);
}

// Event listener for when the bot becomes ready and online
client.once('ready', () => {
    const timestamp = new Date().toLocaleString();
    console.log(`Logged in as ${client.user.tag} at ${timestamp}`);
    
    // Initialize the event-driven challenge expiry handler
    initializeChallengeExpiryHandler(client);
    
    // Run a safety check on startup
    runSafetyCheck(client);
    
    // Set up a recurring safety check every hour
    // This ensures we don't miss any expirations due to Redis connection issues
    setInterval(() => {
        runSafetyCheck(client);
    }, 60 * 60 * 1000); // 1 hour in milliseconds
});

// Event listener for handling interactions (slash commands and autocomplete)
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        // Slash Command Handling

        // Retrieve the command from the client's command collection
        const command = client.commands.get(interaction.commandName);

        // If the command doesn't exist, ignore it
        if (!command) return;

        // Check if the user has the '@SvS Dueler' role by name, except for /talrasha command
        if (command.data.name !== 'talrasha') {
            const duelerRole = interaction.guild.roles.cache.find(role => role.name === 'SvS Dueler');
            if (!duelerRole || !interaction.member.roles.cache.has(duelerRole.id)) {
                return interaction.reply({
                    content: 'You do not have the required @SvS Dueler role to use this command.',
                    ephemeral: true
                });
            }
        }

        try {
            // Execute the command
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            // Respond with an error message if command execution fails
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    } else if (interaction.isAutocomplete()) {
        // Autocomplete Handling

        // Retrieve the command from the client's command collection
        const command = client.commands.get(interaction.commandName);

        // If the command doesn't exist, ignore it
        if (!command) return;

        try {
            // Execute the autocomplete handler
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(error);
        }
    }
});

// Login to Discord with your bot token
client.login(process.env.BOT_TOKEN);

// Setup a basic HTTP server to satisfy Heroku
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('SvS Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
