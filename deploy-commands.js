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
        console.log('Started refreshing application (/) commands.');

        // Fetch current commands
        const currentCommands = await rest.get(
            Routes.applicationCommands(process.env.CLIENT_ID),
        );

        const currentCommandNames = currentCommands.map(cmd => cmd.name);
        const newCommandNames = commands.map(cmd => cmd.name);

        const commandsToUpdate = commands.filter(cmd => {
            const existingCommand = currentCommands.find(currentCmd => currentCmd.name === cmd.name);
            return !existingCommand || JSON.stringify(existingCommand.options) !== JSON.stringify(cmd.options);
        });

        if (commandsToUpdate.length > 0) {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commandsToUpdate }
            );
            console.log(`Successfully updated ${commandsToUpdate.length} application (/) commands.`);
        } else {
            console.log('No changes detected in commands. Skipping update.');
        }
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
})();