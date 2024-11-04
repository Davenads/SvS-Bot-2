const fs = require('fs');
const { REST, Routes } = require('discord.js');

require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    console.log(`Loading command: ${command.data.name}`); // Log the command names being loaded
    commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands for multiple guilds.');

        // Deploy to test server
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands for the test guild.');

        // Deploy to live server (Diablo Dueling Leagues)
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.LIVE_GUILD_ID),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands for the live guild.');
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
})();
