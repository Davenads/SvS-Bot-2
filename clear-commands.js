require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log('Started clearing application (/) commands.');

        // Fetch all registered global commands
        const commands = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
        
        for (const command of commands) {
            console.log(`Deleting command: ${command.name}`);
            await rest.delete(`${Routes.applicationCommands(process.env.CLIENT_ID)}/${command.id}`);
        }

        console.log('Successfully cleared all application (/) commands.');
    } catch (error) {
        console.error('Error clearing commands:', error);
    }
})();
