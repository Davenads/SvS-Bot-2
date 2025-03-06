# Discord.js v13 to v14 Migration Cheat Sheet

## Technical Changes Summary
Discord.js v14 includes significant changes, primarily updating to Discord API v10, integrating previously separate packages, and enforcing stricter use of enums and class naming conventions. Below are detailed, actionable steps for upgrading your bot.

## Required Environment Updates
- **Node.js Version**: Update Node.js to LTS v16 or newer.

## Major Technical Changes
- **Enums and Constants**: Moved from string-based or `Intents.FLAGS` usage to numeric enums.
- **Builders**: Classes like `MessageEmbed` and `Modal` renamed to `EmbedBuilder` and `ModalBuilder`.
- **Gateway Intents**: Use `GatewayIntentBits` instead of `Intents.FLAGS`.
- **Partials**: Use the `Partials` enum instead of string arrays.
- **Events and REST**: HTTP handling switched to Undici; REST events moved to `client.rest`.

## Necessary Code Updates

### Client Initialization
```js
// v13
const { Client, Intents } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS], partials: ['CHANNEL'] });

// v14
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});
```

### Slash Commands
```js
// v13
type: 'CHAT_INPUT'

// v14
type: ApplicationCommandType.ChatInput
```

### Command Options
```js
// v13
type: 'STRING'

// v14
type: ApplicationCommandOptionType.String
```

### Message Components (Buttons)
```js
// v13
style: 'PRIMARY'

// v14
style: ButtonStyle.Primary
```

### Embed Changes
```js
// v13
const embed = new MessageEmbed().addField('Name', 'Value');

// v14
const embed = new EmbedBuilder().addFields({ name: 'Name', value: 'Value' });
```

### Channel Type Checks
```js
// v13
if (channel.isText()) {}

// v14
if (channel.type === ChannelType.GuildText) {}
```

### Permissions Updates
```js
// v13
Permissions.FLAGS.USE_PUBLIC_THREADS

// v14
PermissionFlagsBits.CreatePublicThreads
```

### Message Components
```js
// v13
style: 'PRIMARY'

// v14
style: ButtonStyle.Primary
```

### REST Events
```js
// v13
client.on('rateLimit', handler);

// v14
client.rest.on('rateLimited', handler);
```

### Utility Methods
- `Util.removeMentions()` and `Util.splitMessage()` were removed; implement custom logic.
- `Util.escapeMarkdown()` now imported directly:
```js
const { escapeMarkdown } = require('discord.js');
```

## Removed/Deprecated Elements
- `message.deleted` property removed.
- `channel.isVoice()`, `channel.isDM()`, `channel.isThread()` methods removed.
- Deprecated permissions (`USE_PUBLIC_THREADS`) updated (`CREATE_PUBLIC_THREADS`).
- `Webhook#fetchMessage()` now takes options object, not boolean.

## Migration Guide Summary
1. **Update Node.js** to v16 or newer.
2. **Upgrade discord.js** package to v14.
3. Replace string constants with enums (`GatewayIntentBits`, `ApplicationCommandType`, etc.).
4. Rename Embed and Modal classes (`MessageEmbed` → `EmbedBuilder`, etc.).
5. Refactor removed or changed methods (`addField` → `addFields`).
6. Handle rate limits/events via new REST manager (`client.rest`).
7. Thoroughly test bot functionality after migration.

This structured cheat sheet supports efficient updating of your discord.js bot from v13 to v14.

