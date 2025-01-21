const fs = require('fs');
const { REST, Routes } = require('discord.js');

require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command && command.data && command.data.name) {
        console.log(`Loading command: ${command.data.name}`); // Log the command names being loaded
        commands.push(command.data.toJSON());
    } else {
        console.error(`Error loading command from file: ${file}. Command data or name is undefined.`);
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands for multiple guilds.');

        // Deploy to test server
        if (process.env.TEST_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
                { body: commands }
            );
            console.log('Successfully reloaded application (/) commands for the test guild.');
        }

        // Deploy to live server (D2RPvPLeague)
        if (process.env.LIVE_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.LIVE_GUILD_ID),
                { body: commands }
            );
            console.log('Successfully reloaded application (/) commands for the live guild.');
        }
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
})();
