// redis-client.js
const Redis = require('ioredis');
const moment = require('moment-timezone');
const { logError } = require('./logger');
const { EventEmitter } = require('events');

// Map timezone abbreviations to IANA timezone names
const timezoneMap = {
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles'
};

class RedisClient extends EventEmitter {
    // Helper method to determine Redis configuration based on environment
    getRedisConfig() {
        // Check if running on Heroku with RedisCloud
        if (process.env.REDISCLOUD_URL) {
            // Parse the RedisCloud URL
            const redisUrl = new URL(process.env.REDISCLOUD_URL);
            return {
                host: redisUrl.hostname,
                port: parseInt(redisUrl.port),
                password: redisUrl.password ? redisUrl.password : null,
                tls: redisUrl.protocol === 'rediss:' ? {} : null,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                }
            };
        } else {
            // Local or custom Redis configuration
            return {
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                }
            };
        }
    }

    constructor() {
        super();

        // Skip Redis initialization if explicitly disabled (useful for deploy-commands.js)
        if (process.env.SKIP_REDIS_INIT === 'true') {
            console.log('Redis initialization skipped (SKIP_REDIS_INIT=true)');
            this.client = null;
            this.subClient = null;
            return;
        }

        // Configure Redis clients based on environment
        const redisConfig = this.getRedisConfig();

        // Main client for regular operations
        this.client = new Redis(redisConfig);

        // Separate subscription client for keyspace notifications
        // Disable ready check for subscriber client to avoid command errors
        this.subClient = new Redis({
            ...redisConfig,
            enableReadyCheck: false
        });

        this.client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            logError('Redis Client Error', err);
        });

        this.client.on('connect', () => {
            console.log('Redis Client Connected');
            // Configure Redis to enable keyspace events for expired keys
            this.client.config('SET', 'notify-keyspace-events', 'Ex');
        });
        
        this.subClient.on('error', (err) => {
            console.error('Redis Subscription Client Error:', err);
            logError('Redis Subscription Client Error', err);
        });

        this.subClient.on('connect', () => {
            console.log('Redis Subscription Client Connected');
            // Subscribe to expiration events
            this.subClient.subscribe('__keyevent@0__:expired');
        });
        
        // Handle expiration events
        this.subClient.on('message', (channel, message) => {
            console.log(`Received message from channel ${channel}: ${message}`);
            
            // Handle challenge expirations
            if (channel === '__keyevent@0__:expired') {
                if (message.startsWith('challenge:')) {
                    console.log(`Challenge key expired: ${message}`);
                    this.emit('challengeExpired', message);
                } else if (message.startsWith('challenge-warning:')) {
                    console.log(`Challenge warning key expired: ${message}`);
                    this.emit('challengeWarning', message.replace('challenge-warning:', 'challenge:'));
                }
            }
        });
    }

    // Key format: `cooldown:${discordId1}-${element1}:${discordId2}-${element2}`
    generateCooldownKey(player1, player2) {
        const pair = [
            `${player1.discordId}-${player1.element}`,
            `${player2.discordId}-${player2.element}`
        ].sort(); // Sort to ensure consistent key regardless of order
        return `cooldown:${pair[0]}:${pair[1]}`;
    }

    // Key format: `challenge:${discordId1}-${element1}:${discordId2}-${element2}`
    generateChallengeKey(player1, player2) {
        const pair = [
            `${player1.discordId}-${player1.element}`,
            `${player2.discordId}-${player2.element}`
        ].sort(); // Sort to ensure consistent key regardless of order
        return `challenge:${pair[0]}:${pair[1]}`;
    }

    async setCooldown(player1, player2) {
        const key = this.generateCooldownKey(player1, player2);
        const expiryTime = 24 * 60 * 60; // 24 hours in seconds
        const cooldownData = JSON.stringify({
            player1: {
                discordId: player1.discordId,
                name: player1.name,
                element: player1.element
            },
            player2: {
                discordId: player2.discordId,
                name: player2.name,
                element: player2.element
            },
            startTime: Date.now(),
            expiryTime: Date.now() + (expiryTime * 1000)
        });
        
        try {
            await this.client.setex(key, expiryTime, cooldownData);
            console.log(`Set cooldown for ${key} with expiry ${expiryTime}s`);
            return true;
        } catch (error) {
            console.error('Error setting cooldown:', error);
            logError('Error setting cooldown', error);
            return false;
        }
    }

    // Calculate TTL based on challenge date from Google Sheets
    // Format: "6/25, 12:40 AM EDT" -> TTL in seconds until 3 days from that date
    calculateTTLFromChallengeDate(challengeDateStr) {
        try {
            // Parse the challenge date string
            // Format examples: "6/25, 12:40 AM EDT", "12/1, 3:15 PM EST"
            const currentYear = new Date().getFullYear();

            // Extract the timezone abbreviation from the end of the string
            const tzMatch = challengeDateStr.match(/ (EDT|EST|PST|PDT|CST|CDT|MST|MDT)$/);
            const tzAbbrev = tzMatch ? tzMatch[1] : 'EST';
            const ianaTimezone = timezoneMap[tzAbbrev] || 'America/New_York';

            // Remove timezone abbreviation for parsing
            const dateStr = challengeDateStr.replace(/ (EDT|EST|PST|PDT|CST|CDT|MST|MDT)$/, '');

            // Parse the date in the correct timezone using moment-timezone
            // Format: "M/D, h:mm A" -> "1/12, 11:29 AM"
            const challengeDate = moment.tz(`${dateStr}, ${currentYear}`, 'M/D, h:mm A, YYYY', ianaTimezone);

            // If the parsed date is invalid, fall back to current time
            if (!challengeDate.isValid()) {
                console.log(`Warning: Could not parse challenge date "${challengeDateStr}", using current time`);
                return 3 * 24 * 60 * 60; // 3 days from now
            }

            // Calculate expiration: challenge date + 3 days
            const expirationDate = challengeDate.clone().add(3, 'days');

            // Calculate TTL: seconds from now until expiration
            const ttlMs = expirationDate.valueOf() - Date.now();
            const ttlSeconds = Math.max(300, Math.floor(ttlMs / 1000)); // Minimum 5 minutes

            console.log(`Challenge date: ${challengeDate.format()} (${ianaTimezone}), expires: ${expirationDate.format()}, TTL: ${ttlSeconds}s`);
            return ttlSeconds;

        } catch (error) {
            console.error(`Error parsing challenge date "${challengeDateStr}":`, error);
            return 3 * 24 * 60 * 60; // Fallback to 3 days
        }
    }

    async setChallenge(player1, player2, challengeDate) {
        const key = this.generateChallengeKey(player1, player2);
        
        let expiryTime;
        if (challengeDate) {
            // Parse challenge date and calculate TTL based on 3-day expiration from that date
            expiryTime = this.calculateTTLFromChallengeDate(challengeDate);
        } else {
            // Fallback to default 3 days
            expiryTime = 3 * 24 * 60 * 60;
        }
        // Warning time: 24 hours before expiration, but minimum 300 seconds (5 minutes)
        const warningTime = Math.max(300, expiryTime - (24 * 60 * 60));
        
        const challengeData = JSON.stringify({
            player1: {
                discordId: player1.discordId,
                name: player1.name,
                element: player1.element,
                rank: player1.rank
            },
            player2: {
                discordId: player2.discordId,
                name: player2.name,
                element: player2.element,
                rank: player2.rank
            },
            challengeDate: challengeDate,
            startTime: Date.now(),
            expiryTime: Date.now() + (expiryTime * 1000)
        });
        
        try {
            // Set the main challenge with expiration
            await this.client.setex(key, expiryTime, challengeData);
            console.log(`Set challenge for ${key} with expiry ${expiryTime}s`);
            
            // Set a separate key for the warning (expires 24 hours before the main challenge)
            const warningKey = `challenge-warning:${key.substring(10)}`;
            await this.client.setex(warningKey, warningTime, key);
            console.log(`Set warning for ${warningKey} with expiry ${warningTime}s`);
            
            return true;
        } catch (error) {
            console.error('Error setting challenge:', error);
            logError('Error setting challenge', error);
            return false;
        }
    }

    async updateChallenge(player1, player2, newChallengeDate) {
        const key = this.generateChallengeKey(player1, player2);
        // Reset to 3 days from now
        const expiryTime = 3 * 24 * 60 * 60;
        // 24 hours before expiration (for warning) - 2 days
        const warningTime = 2 * 24 * 60 * 60;
        
        try {
            const challengeDataStr = await this.client.get(key);
            
            if (!challengeDataStr) {
                console.error(`Challenge not found for ${key}`);
                return false;
            }
            
            const challengeData = JSON.parse(challengeDataStr);
            
            // Update challenge date and reset expiration
            challengeData.challengeDate = newChallengeDate;
            challengeData.startTime = Date.now();
            challengeData.expiryTime = Date.now() + (expiryTime * 1000);
            
            // Remove old warning key if it exists
            const oldWarningKey = `challenge-warning:${key.substring(10)}`;
            await this.client.del(oldWarningKey);
            
            // Set main challenge with updated data
            await this.client.setex(key, expiryTime, JSON.stringify(challengeData));
            console.log(`Updated challenge for ${key} with new expiry ${expiryTime}s`);
            
            // Set a new warning key
            const warningKey = `challenge-warning:${key.substring(10)}`;
            await this.client.setex(warningKey, warningTime, key);
            console.log(`Reset warning for ${warningKey} with expiry ${warningTime}s`);
            
            return true;
        } catch (error) {
            console.error('Error updating challenge:', error);
            logError('Error updating challenge', error);
            return false;
        }
    }

    async checkChallenge(player1, player2) {
        const key = this.generateChallengeKey(player1, player2);
        
        try {
            const challengeData = await this.client.get(key);
            if (challengeData) {
                const ttl = await this.client.ttl(key);
                const data = JSON.parse(challengeData);
                return {
                    active: true,
                    remainingTime: ttl,
                    details: data
                };
            }
            return {
                active: false,
                remainingTime: 0,
                details: null
            };
        } catch (error) {
            console.error('Error checking challenge:', error);
            logError('Error checking challenge', error);
            return {
                active: false,
                remainingTime: 0,
                details: null,
                error: true
            };
        }
    }

    async getAllChallenges() {
        try {
            const keys = await this.client.keys('challenge:*');
            const challenges = [];
            
            for (const key of keys) {
                const challengeData = await this.client.get(key);
                const ttl = await this.client.ttl(key);
                
                if (challengeData) {
                    const data = JSON.parse(challengeData);
                    challenges.push({
                        key: key,
                        player1: data.player1,
                        player2: data.player2,
                        challengeDate: data.challengeDate,
                        remainingTime: ttl,
                        warningNotificationSent: data.warningNotificationSent || false
                    });
                }
            }
            
            return challenges;
        } catch (error) {
            console.error('Error listing challenges:', error);
            logError('Error listing challenges', error);
            return [];
        }
    }

    // Create or check a warning lock to prevent duplicate notifications
    async markChallengeWarningAsSent(player1, player2) {
        const key = this.generateChallengeKey(player1, player2);
        const warningLockKey = `warning-lock:${key.substring(10)}`;
        
        try {
            // Try to set the lock with NX option (only set if it doesn't exist)
            // This lock will expire after 60 seconds to prevent any potential deadlock
            const result = await this.client.set(warningLockKey, '1', 'EX', 60, 'NX');
            
            // If result is null, the key already exists (warning already sent)
            if (result === null) {
                console.log(`Warning already sent for challenge ${key} (lock exists)`);
                return false;
            }
            
            console.log(`Set warning lock for ${key}`);
            return true;
        } catch (error) {
            console.error('Error setting warning lock:', error);
            logError('Error setting warning lock', error);
            // If there's an error, allow the warning to be sent (fail open)
            return true;
        }
    }

    async removeChallenge(player1, player2) {
        const key = this.generateChallengeKey(player1, player2);
        const warningKey = `challenge-warning:${key.substring(10)}`;
        
        try {
            // Remove both the challenge key and warning key
            await this.client.del(key);
            await this.client.del(warningKey);
            console.log(`Removed challenge and warning for ${key}`);
            return true;
        } catch (error) {
            console.error('Error removing challenge:', error);
            logError('Error removing challenge', error);
            return false;
        }
    }

    async checkCooldown(player1, player2) {
        const key = this.generateCooldownKey(player1, player2);
        
        try {
            const cooldownData = await this.client.get(key);
            if (cooldownData) {
                const ttl = await this.client.ttl(key);
                const data = JSON.parse(cooldownData);
                return {
                    onCooldown: true,
                    remainingTime: ttl,
                    details: data
                };
            }
            return {
                onCooldown: false,
                remainingTime: 0,
                details: null
            };
        } catch (error) {
            console.error('Error checking cooldown:', error);
            logError('Error checking cooldown', error);
            return {
                onCooldown: false,
                remainingTime: 0,
                details: null,
                error: true
            };
        }
    }

    async removeCooldown(player1, player2) {
        const key = this.generateCooldownKey(player1, player2);
        
        try {
            await this.client.del(key);
            console.log(`Removed cooldown for ${key}`);
            return true;
        } catch (error) {
            console.error('Error removing cooldown:', error);
            logError('Error removing cooldown', error);
            return false;
        }
    }

    // Debug method to list all active cooldowns
    async listAllCooldowns() {
        try {
            const keys = await this.client.keys('cooldown:*');
            const cooldowns = [];
            
            for (const key of keys) {
                const cooldownData = await this.client.get(key);
                const ttl = await this.client.ttl(key);
                
                if (cooldownData) {
                    const data = JSON.parse(cooldownData);
                    cooldowns.push({
                        player1: data.player1,
                        player2: data.player2,
                        remainingTime: ttl
                    });
                }
            }
            
            return cooldowns;
        } catch (error) {
            console.error('Error listing cooldowns:', error);
            logError('Error listing cooldowns', error);
            return [];
        }
    }

    // Helper method to get all cooldowns for a specific player's Discord ID
    async getPlayerCooldowns(discordId) {
        try {
            const keys = await this.client.keys('cooldown:*');
            const cooldowns = [];
            
            for (const key of keys) {
                const cooldownData = await this.client.get(key);
                if (cooldownData) {
                    const data = JSON.parse(cooldownData);
                    if (data.player1.discordId === discordId || data.player2.discordId === discordId) {
                        const ttl = await this.client.ttl(key);
                        cooldowns.push({
                            opponent: data.player1.discordId === discordId ? data.player2 : data.player1,
                            remainingTime: ttl
                        });
                    }
                }
            }
            
            return cooldowns;
        } catch (error) {
            console.error('Error getting player cooldowns:', error);
            logError('Error getting player cooldowns', error);
            return [];
        }
    }
}

module.exports = new RedisClient();