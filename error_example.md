[2025-03-05T23:35:47.780Z] Command invoked: /leaderboard by shweaty_betty (666787679693832260)
(node:8996) Warning: Supplying "ephemeral" for interaction response options is deprecated. Utilize flags instead.
(Use `node --trace-warnings ...` to show where the warning was created)
Detailed error: Interaction has already been acknowledged.
DiscordAPIError[40060]: Interaction has already been acknowledged.
    at handleErrors (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\@discordjs\rest\dist\index.js:727:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async BurstHandler.runRequest (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\@discordjs\rest\dist\index.js:831:23)
    at async _REST.request (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\@discordjs\rest\dist\index.js:1272:22)   
    at async ChatInputCommandInteraction.deferReply (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\discord.js\src\structures\interfaces\InteractionResponses.js:123:22)
    at async deferIfNecessary (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\commands\leaderboard.js:18:17)
    at async Object.execute (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\commands\leaderboard.js:178:13)
    at async Client.<anonymous> (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\index.js:59:13) {
  requestBody: { files: undefined, json: { type: 5, data: [Object] } },
  rawError: {
    message: 'Interaction has already been acknowledged.',
    code: 40060
  },
  code: 40060,
  status: 400,
  method: 'POST',
  url: 'https://discord.com/api/v10/interactions/1346989600849268788/aW50ZXJhY3Rpb246MTM0Njk4OTYwMDg0OTI2ODc4ODpJbVVwRUxPNFpIRGVTd3VscEZSOG43UnBuN2JwZXIwRUoyQU4yUTA2aDdNbjJMSkJoNTJEMzMxRzRGbkxvbXV2UFlkVnlvd2tRTERma1RRa1R6dlFsR3h3VzZUZkg4azhtTWM5Q0hJaGR1NzNiQ2dic3EyUlFQS0l4bWJ1bGVadA/callback?with_response=false'
}
node:events:497
      throw er; // Unhandled 'error' event
      ^

DiscordAPIError[40060]: Interaction has already been acknowledged.
    at handleErrors (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\@discordjs\rest\dist\index.js:727:13)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async BurstHandler.runRequest (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\@discordjs\rest\dist\index.js:831:23)
    at async _REST.request (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\@discordjs\rest\dist\index.js:1272:22)   
    at async ChatInputCommandInteraction.reply (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\node_modules\discord.js\src\structures\interfaces\InteractionResponses.js:194:22)
    at async Client.<anonymous> (C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2\index.js:63:13)
Emitted 'error' event on Client instance at:
    at emitUnhandledRejectionOrErr (node:events:402:10)
    at process.processTicksAndRejections (node:internal/process/task_queues:84:21) {
  requestBody: {
    files: [],
    json: {
      type: 4,
      data: {
        content: 'There was an error while executing this command!',
        tts: false,
        nonce: undefined,
        enforce_nonce: false,
        embeds: undefined,
        components: undefined,
        username: undefined,
        avatar_url: undefined,
        allowed_mentions: undefined,
        flags: 64,
        message_reference: undefined,
        attachments: undefined,
        sticker_ids: undefined,
        thread_name: undefined,
        applied_tags: undefined,
        poll: undefined
      }
    }
  },
  rawError: {
    message: 'Interaction has already been acknowledged.',
    code: 40060
  },
  code: 40060,
  status: 400,
  method: 'POST',
  url: 'https://discord.com/api/v10/interactions/1346989600849268788/aW50ZXJhY3Rpb246MTM0Njk4OTYwMDg0OTI2ODc4ODpJbVVwRUxPNFpIRGVTd3VscEZSOG43UnBuN2JwZXIwRUoyQU4yUTA2aDdNbjJMSkJoNTJEMzMxRzRGbkxvbXV2UFlkVnlvd2tRTERma1RRa1R6dlFsR3h3VzZUZkg4azhtTWM5Q0hJaGR1NzNiQ2dic3EyUlFQS0l4bWJ1bGVadA/callback?with_response=false'
}

Node.js v20.14.0
(base) PS C:\Users\david\OneDrive\Desktop\Apps\SvS-Bot-2>