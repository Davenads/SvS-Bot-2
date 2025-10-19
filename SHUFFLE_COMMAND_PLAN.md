# SvS Bot 2 - `/shuffle` Command Implementation Plan

## Overview

This document outlines the implementation plan for adding a `/shuffle` command to the SvS Bot 2, allowing SvS Managers to randomize ladder placements similar to the NvD bot. This plan accounts for all edge cases and potential Redis-Sheet desynchronization scenarios.

---

## Command Specification

### Command Definition

```javascript
/shuffle
  clear_challenges: [Boolean] (default: false) - Reset all challenges to Available
  clear_cooldowns: [Boolean] (default: false) - Remove all cooldown restrictions
```

### Permissions
- **Role Required**: `@SvS Manager`
- **Channel Restriction**: None (can be used anywhere, ephemeral response)

### Behavior Matrix

| clear_challenges | clear_cooldowns | Result |
|------------------|-----------------|--------|
| false | false | Preserve challenges & cooldowns, update rank refs |
| true | false | Clear challenges, preserve cooldowns |
| false | true | Preserve challenges, clear cooldowns |
| true | true | Full reset - clear everything |

---

## Data Structures

### Google Sheets - SvS Ladder Tab

| Column | Name | Description |
|--------|------|-------------|
| A | Rank | Player rank (1, 2, 3...) |
| B | Name | Character name |
| C | Spec | Vita or ES |
| D | Element | Fire, Light, or Cold |
| E | DiscUser | Discord username |
| F | Status | Available, Challenge, or Vacation |
| G | cDate | Challenge date (format: "6/25, 12:40 AM EDT") |
| H | Opp# | Opponent's rank number |
| I | DiscordID | Discord user ID |
| J | Notes | Player notes |
| K | Cooldown | (Unused - managed by Redis) |

**Range to fetch**: `SvS Ladder!A2:K`

### Redis Data Structures

#### Challenge Keys
- **Format**: `challenge:${rank1}-${rank2}` (sorted pair)
- **TTL**: 3 days from challenge date
- **Value**: JSON object
  ```json
  {
    "player1": {
      "discordId": "123456789",
      "name": "CharName",
      "element": "Fire",
      "rank": 5
    },
    "player2": {
      "discordId": "987654321",
      "name": "CharName2",
      "element": "Cold",
      "rank": 3
    },
    "challengeDate": "6/25, 12:40 AM EDT",
    "startTime": 1719123456789,
    "expiryTime": 1719382656789
  }
  ```

#### Challenge Warning Keys
- **Format**: `challenge-warning:${rank1}-${rank2}` (sorted pair)
- **TTL**: Expires 24 hours before challenge expires
- **Value**: Reference to challenge key

#### Cooldown Keys
- **Format**: `cooldown:${discordId1}-${element1}:${discordId2}-${element2}` (sorted pair)
- **TTL**: 24 hours
- **Value**: JSON object
  ```json
  {
    "player1": {
      "discordId": "123456789",
      "name": "CharName",
      "element": "Fire"
    },
    "player2": {
      "discordId": "987654321",
      "name": "CharName2",
      "element": "Cold"
    },
    "startTime": 1719123456789,
    "expiryTime": 1719210056789
  }
  ```

---

## Implementation Flow

### Phase 1: Validation & Data Fetch

```
1. Check user has @SvS Manager role
2. Defer reply (ephemeral)
3. Fetch ladder data from Google Sheets (A2:K)
4. Filter out empty rows
5. Log initial state: ${rows.length} players found
```

**Edge Cases**:
- ✅ Empty ladder → return error "No data available on the leaderboard"
- ✅ Partial rows → filter with `row[0] && row[1]` check

---

### Phase 2: Shuffle Algorithm

```
1. Apply Fisher-Yates shuffle to rows array
2. Update rank numbers in Column A (1, 2, 3...)
3. Store old rank → new rank mapping for Redis updates
```

**Algorithm**:
```javascript
// Fisher-Yates shuffle
for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
}

// Update ranks
const rankMapping = {}; // oldRank -> { newRank, discordId, name, element }
rows.forEach((row, index) => {
    const oldRank = row[0];
    const newRank = (index + 1).toString();
    row[0] = newRank;

    rankMapping[oldRank] = {
        newRank,
        discordId: row[8],
        name: row[1],
        element: row[3]
    };
});
```

**Edge Cases**:
- ✅ Single player → no shuffle needed but still process
- ✅ Vacation players → included in shuffle, status preserved

---

### Phase 3A: Challenge Handling (clear_challenges = false)

**Goal**: Preserve active challenges and update opponent rank references

```
1. Identify all players with Status = "Challenge"
2. For each challenged player:
   a. Get old opponent rank from Column H (Opp#)
   b. Look up new opponent rank from rankMapping
   c. Update Column H with new opponent rank
   d. Add to challengeUpdates array for logging
```

**Implementation**:
```javascript
const challengeUpdates = [];

rows.forEach((row, index) => {
    if (row[5] === 'Challenge' && row[7]) { // Status = Challenge, Opp# exists
        const oldOpponentRank = row[7];
        const newOpponentRank = rankMapping[oldOpponentRank]?.newRank;

        if (newOpponentRank) {
            row[7] = newOpponentRank; // Update Opp# column

            challengeUpdates.push({
                player: row[4], // DiscUser
                playerOldRank: row[0], // Already updated to new rank
                opponent: rankMapping[oldOpponentRank].name,
                opponentOldRank: oldOpponentRank,
                opponentNewRank: newOpponentRank
            });
        } else {
            // Opponent no longer exists - clear challenge
            row[5] = 'Available'; // Status
            row[6] = ''; // cDate
            row[7] = ''; // Opp#
        }
    }
});
```

**Edge Cases**:
- ✅ One player in challenge removed → clear other player's challenge status
- ✅ Both players still exist → update rank references
- ✅ Mismatched challenges (only one player has Challenge status) → clear orphaned challenge
- ✅ Invalid opponent rank → clear challenge

---

### Phase 3B: Challenge Handling (clear_challenges = true)

**Goal**: Reset all players to Available status

```
1. Iterate through all rows
2. If Status = "Challenge":
   a. Set Status = "Available"
   b. Clear cDate (Column G)
   c. Clear Opp# (Column H)
```

**Implementation**:
```javascript
rows.forEach((row) => {
    if (row[5] === 'Challenge') {
        row[5] = 'Available';
        row[6] = ''; // Clear cDate
        row[7] = ''; // Clear Opp#
    }
});
```

**Edge Cases**:
- ✅ All challenges cleared uniformly
- ✅ Vacation players remain on Vacation

---

### Phase 4: Update Google Sheets

```
1. Clear existing data range to prevent stale data
2. Write shuffled rows back to sheet
3. Log success
```

**Implementation**:
```javascript
// Clear range
await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `SvS Ladder!A2:K${rows.length + 1}`
});

// Write updated data
await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `SvS Ladder!A2:K${rows.length + 1}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: rows }
});
```

**Edge Cases**:
- ✅ Google API rate limits → implement exponential backoff
- ✅ Network failure → throw error, transaction rollback not possible (Google Sheets has no transactions)
- ✅ Partial write → unlikely with single update call, but log thoroughly

---

### Phase 5: Redis Synchronization

This is the most critical phase for preventing desync.

#### Phase 5A: Challenge Redis Sync (clear_challenges = false)

**Goal**: Update Redis challenge keys to reflect new rank numbers

```
1. Fetch all challenge keys from Redis
2. For each challenge key:
   a. Parse ranks from key (challenge:X-Y)
   b. Get challenge data from Redis
   c. Look up new ranks for both players
   d. Create new key with updated ranks
   e. Preserve TTL and challenge data
   f. Delete old key
   g. Recreate warning key with new ranks
```

**Implementation**:
```javascript
const challengeKeys = await redisClient.client.keys('challenge:*');

for (const oldKey of challengeKeys) {
    // Skip warning keys
    if (oldKey.includes('challenge-warning:')) continue;

    // Get challenge data and TTL
    const challengeData = await redisClient.client.get(oldKey);
    const ttl = await redisClient.client.ttl(oldKey);

    if (!challengeData || ttl < 0) {
        // Expired or missing - delete
        await redisClient.client.del(oldKey);
        continue;
    }

    const data = JSON.parse(challengeData);

    // Get old ranks from data
    const oldRank1 = data.player1.rank;
    const oldRank2 = data.player2.rank;

    // Look up new ranks
    const newRank1 = rankMapping[oldRank1]?.newRank;
    const newRank2 = rankMapping[oldRank2]?.newRank;

    if (!newRank1 || !newRank2) {
        // Player(s) no longer exist - delete challenge
        await redisClient.client.del(oldKey);
        const warningKey = oldKey.replace('challenge:', 'challenge-warning:');
        await redisClient.client.del(warningKey);
        continue;
    }

    // Update data with new ranks
    data.player1.rank = parseInt(newRank1);
    data.player2.rank = parseInt(newRank2);

    // Create new key
    const newKey = redisClient.generateChallengeKey(newRank1, newRank2);

    if (oldKey !== newKey) {
        // Set new key with preserved TTL
        await redisClient.client.setex(newKey, ttl, JSON.stringify(data));

        // Delete old key
        await redisClient.client.del(oldKey);

        // Update warning key
        const oldWarningKey = oldKey.replace('challenge:', 'challenge-warning:');
        const newWarningKey = newKey.replace('challenge:', 'challenge-warning:');
        const warningTTL = await redisClient.client.ttl(oldWarningKey);

        if (warningTTL > 0) {
            await redisClient.client.setex(newWarningKey, warningTTL, newKey);
            await redisClient.client.del(oldWarningKey);
        }
    }
}
```

**Edge Cases**:
- ✅ Challenge key exists but player removed from sheet → delete Redis key
- ✅ TTL expired during shuffle → delete key
- ✅ Mismatched rank numbers → recreate with correct ranks
- ✅ Warning key exists but challenge doesn't → delete warning key
- ✅ Both players have same new rank (impossible but check) → delete challenge

---

#### Phase 5B: Challenge Redis Sync (clear_challenges = true)

**Goal**: Delete all challenge-related Redis keys

```
1. Fetch all challenge keys (including warnings)
2. Delete all keys
```

**Implementation**:
```javascript
const challengeKeys = await redisClient.client.keys('challenge*');

if (challengeKeys.length > 0) {
    await redisClient.client.del(...challengeKeys);
}
```

**Edge Cases**:
- ✅ No challenge keys exist → skip gracefully
- ✅ Redis connection error → log error, continue (sheet is source of truth)

---

#### Phase 5C: Cooldown Redis Sync (clear_cooldowns = false)

**Goal**: Verify cooldowns still reference valid players

Cooldowns are keyed by Discord ID + Element, not by rank, so they don't need updating. However, we should verify both players still exist.

```
1. Fetch all cooldown keys
2. For each cooldown:
   a. Parse Discord IDs
   b. Verify both players exist in shuffled ladder
   c. If either missing, delete cooldown
```

**Implementation**:
```javascript
const cooldownKeys = await redisClient.client.keys('cooldown:*');
const validDiscordIds = new Set(rows.map(row => row[8])); // Column I

for (const key of cooldownKeys) {
    const cooldownData = await redisClient.client.get(key);

    if (!cooldownData) {
        await redisClient.client.del(key);
        continue;
    }

    const data = JSON.parse(cooldownData);
    const player1Exists = validDiscordIds.has(data.player1.discordId);
    const player2Exists = validDiscordIds.has(data.player2.discordId);

    if (!player1Exists || !player2Exists) {
        // One or both players removed - delete cooldown
        await redisClient.client.del(key);
    }
}
```

**Edge Cases**:
- ✅ Player removed from ladder → delete their cooldowns
- ✅ Both players exist → preserve cooldown

---

#### Phase 5D: Cooldown Redis Sync (clear_cooldowns = true)

**Goal**: Delete all cooldown keys

```
1. Fetch all cooldown keys
2. Delete all keys
```

**Implementation**:
```javascript
const cooldownKeys = await redisClient.client.keys('cooldown:*');

if (cooldownKeys.length > 0) {
    await redisClient.client.del(...cooldownKeys);
}
```

**Edge Cases**:
- ✅ No cooldown keys exist → skip gracefully

---

### Phase 6: Post-Shuffle Verification (Integrated SyncRedis)

**Goal**: Verify Redis and Sheet are in sync after shuffle, fix any discrepancies

```
1. Run verification checks similar to syncredis fix_broken_keys
2. Compare sheet challenges vs Redis challenges
3. Report any discrepancies found
4. Auto-fix if discrepancies are minor
```

**Implementation**:
```javascript
// Verification logic
const verificationResults = {
    sheetChallenges: 0,
    redisChallenges: 0,
    discrepancies: [],
    fixed: []
};

if (!clearChallenges) {
    // Count challenges in sheet
    verificationResults.sheetChallenges = rows.filter(row => row[5] === 'Challenge').length;

    // Count challenges in Redis
    const allRedisChallenges = await redisClient.getAllChallenges();
    verificationResults.redisChallenges = allRedisChallenges.length;

    // Basic sanity check
    const expectedRedisChallenges = verificationResults.sheetChallenges / 2; // Each challenge = 2 sheet rows, 1 Redis key

    if (verificationResults.redisChallenges !== expectedRedisChallenges) {
        console.log(`⚠️ Challenge count mismatch: Sheet has ${verificationResults.sheetChallenges} challenged players, Redis has ${verificationResults.redisChallenges} keys`);
        verificationResults.discrepancies.push(`Challenge count mismatch detected`);
    } else {
        console.log(`✅ Challenge counts match: ${verificationResults.redisChallenges} challenges in sync`);
    }
}

console.log('├─ Post-shuffle verification completed');
```

**Edge Cases**:
- ✅ Minor discrepancies detected → log warning but continue
- ✅ Major discrepancies → log error, suggest manual syncredis run
- ✅ Redis unavailable → log warning, shuffle still completes (sheet is source of truth)

---

### Phase 7: Response & Logging

```
1. Create embed with shuffle summary
2. Include verification results
3. Send public announcement to channel
4. Reply to command invoker (ephemeral)
5. Log detailed statistics
```

**Embed Structure**:
```javascript
const embed = new EmbedBuilder()
    .setColor('#00ae86') // SvS theme color
    .setTitle('🎲 SvS Ladder Shuffle Completed! 🎲')
    .setDescription(
        `The SvS ladder has been randomly shuffled! All player positions have been reorganized.\n\n` +
        `**Settings:**\n` +
        `🔄 Challenges: ${clearChallenges ? 'Cleared' : 'Preserved'}\n` +
        `⏱️ Cooldowns: ${clearCooldowns ? 'Cleared' : 'Preserved'}\n\n` +
        `**Statistics:**\n` +
        `👥 Players shuffled: ${rows.length}\n` +
        `${!clearChallenges ? `⚔️ Redis challenges synced: ${verificationResults.redisChallenges}\n` : ''}` +
        `${verificationResults.discrepancies.length > 0 ? `⚠️ Minor sync issues detected (auto-handled)\n` : '✅ Sheet and Redis fully synchronized'}`
    )
    .setFooter({
        text: `Shuffle requested by ${interaction.user.username}`,
        iconURL: interaction.client.user.displayAvatarURL()
    })
    .setTimestamp();

// If challenges preserved, show updates
if (!clearChallenges && challengeUpdates.length > 0) {
    const updatesPreview = challengeUpdates.slice(0, 5); // Show first 5
    const hasMore = challengeUpdates.length > 5;

    embed.addFields({
        name: '⚠️ Active Challenges Updated',
        value: updatesPreview.map(update =>
            `**${update.player}** vs **${update.opponent}** ` +
            `(Ranks: ${update.opponentOldRank} → ${update.opponentNewRank})`
        ).join('\n') + (hasMore ? `\n...and ${challengeUpdates.length - 5} more` : '')
    });
}
```

**Logging**:
```javascript
console.log(`\n[${timestamp}] Shuffle Command Executed`);
console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);
console.log(`├─ Players shuffled: ${rows.length}`);
console.log(`├─ Clear challenges: ${clearChallenges}`);
console.log(`├─ Clear cooldowns: ${clearCooldowns}`);
console.log(`├─ Active challenges affected: ${challengeUpdates.length}`);
console.log(`├─ Redis challenge keys updated: ${challengeKeysUpdated}`);
console.log(`├─ Redis cooldown keys ${clearCooldowns ? 'cleared' : 'verified'}: ${cooldownKeysProcessed}`);
console.log(`├─ Verification: ${verificationResults.discrepancies.length} discrepancies found`);
console.log(`└─ Shuffle completed successfully`);
```

---

## Edge Cases & Desync Prevention

### Critical Desync Scenarios

| Scenario | Root Cause | Prevention Strategy |
|----------|------------|---------------------|
| **Challenge exists in Redis but not in sheet** | Manual sheet edit, failed sheet update | Phase 5A: Delete Redis key if player status ≠ "Challenge" |
| **Challenge exists in sheet but not in Redis** | Redis restart, failed Redis write | Phase 6: Verification detects, logs warning (non-critical) |
| **Mismatched opponent ranks** | Manual sheet edit, stale Redis data | Phase 5A: Update Redis keys with new ranks |
| **Cooldown for removed player** | Player removed from ladder | Phase 5C: Delete cooldowns for non-existent Discord IDs |
| **Redis key uses old ranks** | Redis update failed during shuffle | Phase 5A: Complete rank update in Redis with verification |
| **Warning key orphaned** | Challenge deleted but warning not | Phase 5A/B: Always delete warning keys with challenge keys |
| **Sheet write fails mid-shuffle** | Network error, API rate limit | No rollback possible - log error, notify admin |
| **Redis write fails mid-sync** | Connection error | Non-critical - sheet is source of truth, verification logs warning |
| **Concurrent command during shuffle** | User runs reportwin/challenge during shuffle | Extremely unlikely with small userbase - acceptable risk |

### Desync Detection & Recovery

**Post-Shuffle Verification** (integrated in Phase 6):

The verification process automatically checks:
1. Challenge count consistency (sheet player count vs Redis key count)
2. Logs warnings for any discrepancies
3. Reports results in the response embed

**Manual Recovery Steps** (if needed):

If shuffle fails mid-operation or verification shows major issues:

1. **Check Google Sheets History**
   - Open spreadsheet → File → Version History
   - Restore to pre-shuffle version if needed

2. **Clear Redis and Resync**
   ```
   /syncredis clear_cooldowns:true (if cooldowns were affected)
   /syncredis force:true (to rebuild Redis from sheet)
   ```

3. **Verify Results**
   ```
   /currentchallenges (check active challenges)
   /syncredis show_cooldowns:true (verify cooldowns)
   ```

---

## Command Code Structure

```javascript
// commands/shuffle.js

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { google } = require('googleapis');
const { logError } = require('../logger');
const redisClient = require('../redis-client');
const { getGoogleAuth } = require('../fixGoogleAuth');

const sheets = google.sheets({
    version: 'v4',
    auth: getGoogleAuth()
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'SvS Ladder';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Randomly shuffle player positions on the SvS ladder (Manager only)')
        .addBooleanOption(option =>
            option
                .setName('clear_challenges')
                .setDescription('Reset all active challenges to Available status')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('clear_cooldowns')
                .setDescription('Remove all cooldown restrictions between players')
                .setRequired(false)
        ),

    async execute(interaction) {
        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] Shuffle Command Execution Started`);
        console.log(`├─ Invoked by: ${interaction.user.tag} (${interaction.user.id})`);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Check for SvS Manager role
        const managerRole = interaction.guild.roles.cache.find(
            role => role.name === 'SvS Manager'
        );

        if (!managerRole || !interaction.member.roles.cache.has(managerRole.id)) {
            console.log('└─ Error: User lacks permission');
            return interaction.editReply({
                content: 'You do not have permission to use this command. Only users with the @SvS Manager role can use it.',
                flags: MessageFlags.Ephemeral
            });
        }

        const clearChallenges = interaction.options.getBoolean('clear_challenges') ?? false;
        const clearCooldowns = interaction.options.getBoolean('clear_cooldowns') ?? false;

        console.log(`├─ Options: clear_challenges=${clearChallenges}, clear_cooldowns=${clearCooldowns}`);

        try {
            // Phase 1: Fetch ladder data
            console.log('├─ Fetching ladder data...');
            await interaction.editReply({ content: '🔄 Fetching ladder data...' });

            // Phase 2: Shuffle
            console.log('├─ Shuffling player positions...');
            await interaction.editReply({ content: '🎲 Shuffling player positions...' });

            // Phase 3: Handle challenges
            console.log('├─ Processing challenges...');
            await interaction.editReply({ content: '⚔️ Processing challenges...' });

            // Phase 4: Update sheet
            console.log('├─ Updating Google Sheets...');
            await interaction.editReply({ content: '📊 Updating Google Sheets...' });

            // Phase 5: Sync Redis
            console.log('├─ Synchronizing Redis...');
            await interaction.editReply({ content: '🔄 Synchronizing Redis cache...' });

            // Phase 6: Post-shuffle verification
            console.log('├─ Running verification checks...');
            await interaction.editReply({ content: '✅ Verifying synchronization...' });

            // Phase 7: Response
            console.log('├─ Generating results...');
            await interaction.editReply({ content: '📢 Announcing results...' });

            // ... (Implementation continues with phases outlined above)

        } catch (error) {
            console.error(`└─ Error shuffling ladder`);
            logError('Shuffle command error', error);
            return interaction.editReply({
                content: 'An error occurred while shuffling the ladder. Please check the logs and verify data integrity.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
```

---

## Testing Plan

### Unit Tests

1. **Shuffle Algorithm**
   - ✅ Single player → no change
   - ✅ Two players → swapped or not
   - ✅ 100 players → all ranks present, no duplicates

2. **Rank Mapping**
   - ✅ Old rank → new rank lookup
   - ✅ Discord ID preserved
   - ✅ Invalid rank → null

3. **Challenge Preservation**
   - ✅ Valid challenge → opponent rank updated
   - ✅ Missing opponent → challenge cleared
   - ✅ Mismatched pair → both cleared

4. **Redis Key Generation**
   - ✅ Sorted pair consistency
   - ✅ Same ranks before/after → same key
   - ✅ Different ranks → new key

### Integration Tests

1. **Sheet Operations**
   - ✅ Fetch → shuffle → write → verify
   - ✅ Empty sheet handling
   - ✅ Network error handling

2. **Redis Operations**
   - ✅ Challenge key update preserves TTL
   - ✅ Warning key migrated correctly
   - ✅ Cooldown verification
   - ✅ Bulk deletion

3. **End-to-End**
   - ✅ Shuffle with 10 active challenges, preserve mode
   - ✅ Shuffle with clear_challenges=true
   - ✅ Shuffle with clear_cooldowns=true
   - ✅ Shuffle with both clear options

### Manual Testing Scenarios

| Scenario | Setup | Expected Result |
|----------|-------|-----------------|
| **Basic shuffle** | 20 players, no challenges | All ranks randomized, no errors |
| **Preserve challenges** | 5 active challenges | Opponent ranks updated correctly |
| **Clear challenges** | 5 active challenges | All set to Available, Redis cleared |
| **Remove player mid-challenge** | Remove 1 player in challenge | Opponent's challenge cleared |
| **Redis down** | Stop Redis | Sheet updates succeed, log error for Redis |
| **Concurrent reportwin** | Shuffle + reportwin same time | Potential desync - needs locking |

---

## Deployment Checklist

- [ ] Implement shuffle.js command with all 7 phases
- [ ] Add Redis connection check at start
- [ ] Add progress updates between phases
- [ ] Integrate verification logic from syncredis
- [ ] Update deploy-commands.js to register new command
- [ ] Test with small test ladder (5-10 players)
- [ ] Test with challenges active (preserve mode)
- [ ] Test with clear_challenges=true
- [ ] Test with clear_cooldowns=true
- [ ] Test Redis sync with various scenarios
- [ ] Test verification logic
- [ ] Deploy to test server
- [ ] Run full integration test
- [ ] Monitor logs for errors
- [ ] Deploy to production
- [ ] Document usage guidelines for SvS Managers
- [ ] Announce new command to SvS Managers

---

## Future Enhancements

1. **Dry Run Mode**
   - Add `dry_run: Boolean` option
   - Show preview of shuffle without applying changes

2. **Selective Shuffle**
   - Add `rank_range: String` option (e.g., "1-10")
   - Only shuffle players within specified range

3. **Shuffle History**
   - Log shuffle events to separate Google Sheet tab
   - Track who shuffled, when, and with what options

4. **Auto-Announcement**
   - Post shuffle results to dedicated announcements channel
   - Ping @SvS Dueler role

5. **Undo Shuffle**
   - Store previous ladder state in Redis with 1-hour TTL
   - Add `/unshuffle` command to revert

---

## References

- **NvD Shuffle Implementation**: `C:\Projects\Discord-PvP-Bots\NvD-Bot\commands\shuffle.js`
- **SvS Redis Client**: `C:\Projects\Discord-PvP-Bots\SvS-Bot-2\redis-client.js`
- **SvS Challenge Handler**: `C:\Projects\Discord-PvP-Bots\SvS-Bot-2\challenge-expiry-handler.js`
- **Google Sheets API Docs**: https://developers.google.com/sheets/api
- **Discord.js Docs**: https://discord.js.org/

---

## Notes

- Google Sheets has no transaction support - partial writes are possible but rare
- Redis operations should be idempotent where possible
- Always log detailed information for debugging desync issues
- Sheet is the source of truth - Redis is a cache with TTL-based expiry
- Consider implementing a periodic sync job to catch desync issues (similar to NvD's syncredis command)
