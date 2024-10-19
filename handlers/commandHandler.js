const fs = require('fs');

module.exports = (client) => {
    // Create a collection for commands
    client.commands = new Map();

    // Read all command files from the 'commands' directory
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

    // Loop through each file and set the command data in the client's command collection
    for (const file of commandFiles) {
        const command = require(`../commands/${file}`);

        // Check if the command has both 'data' and 'execute' properties
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            console.log(`Command loaded: ${command.data.name}`); // Log when the command is loaded
        } else {
            console.warn(`Skipping invalid command file: ${file}`);
        }
    }

    // Handle interaction commands
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isCommand()) return;

        const command = client.commands.get(interaction.commandName);

        // Log the interaction details when a command is invoked
        console.log(`Command invoked: ${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id})`);

        if (!command) {
            console.warn(`No command found for: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
            console.log(`Command ${interaction.commandName} executed successfully.`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error executing command ${interaction.commandName}:`, error);

            // Respond to the interaction with an error message
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
        }
    });
};
