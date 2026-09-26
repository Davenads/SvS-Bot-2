// config/emoji.js
//
// Canonical emoji maps shared across dashboards, interaction wizards, and the
// challenge-thread/expiry services. These were previously re-declared inline in
// every renderer and command; centralizing them keeps the ladder's visual
// language in one place (Vita ❤️ / ES 🔵, Fire 🔥 / Light ⚡ / Cold ❄️,
// Available ✅ / Challenge ❌ / Vacation 🌴).

const specEmojiMap = { Vita: '❤️', ES: '🔵' };
const elementEmojiMap = { Fire: '🔥', Light: '⚡', Cold: '❄️' };
const statusEmojiMap = { Available: '✅', Challenge: '❌', Vacation: '🌴' };

module.exports = { specEmojiMap, elementEmojiMap, statusEmojiMap };
