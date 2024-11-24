const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows available commands for SvS duelers'),
    
    async execute(interaction) {
        const helpText = `**📖 Available SvS Commands**

**/challenge** [challenger_rank] [target_rank]
Challenge another player on the ladder
• Top 10 players can challenge up to 2 ranks ahead
• Other players can challenge up to 3 ranks ahead

**/reportwin** [winner_rank] [loser_rank]
Report the outcome of a challenge
• Must be used by either participant in the challenge

**/currentchallenges**
View all active challenges on the ladder
• Shows challenger, opponent, and challenge deadline

**/currentvacations**
See which players are currently on vacation
• Displays vacation start dates and player information

**/leaderboard**
View the current SvS ladder rankings
• Shows all players with their specs, elements, and status

**/talrasha** [character_name] [element] [optional: notes]
Sign up for the Tal Rasha tournament
• Available to all players, no special role required

_Note: You must have the @SvS Dueler role to use most commands (except /talrasha)_`;

        await interaction.reply({ content: helpText, ephemeral: true });
    },
};