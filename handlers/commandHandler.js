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
            console.log(`Command loaded: ${command.data.name}`);
        } else {
            console.warn(`Skipping invalid command file: ${file}`);
        }
    }
};
