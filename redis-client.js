// redis-client.js
const Redis = require('ioredis');
const { logError } = require('./logger');
const { EventEmitter } = require('events');

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

        // Configure Redis clients based on environment
        const redisConfig = this.getRedisConfig();

        // Main client for regular operations
        this.client = new Redis(redisConfig);

        // Separate subscription client for keyspace notifications
        this.subClient = new Redis(redisConfig);

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

    // Key format: `challenge:${player1Rank}-${player2Rank}`
    generateChallengeKey(player1Rank, player2Rank) {
        const pair = [String(player1Rank), String(player2Rank)].sort();
        return `challenge:${pair[0]}-${pair[1]}`;
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

    async setChallenge(player1, player2, challengeDate) {
        const key = this.generateChallengeKey(player1.rank, player2.rank);
        // 3 days expiry (259,200 seconds)
        const expiryTime = 3 * 24 * 60 * 60;
        // 24 hours before expiration (for warning) - 2 days
        const warningTime = 2 * 24 * 60 * 60;
        
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

    async updateChallenge(player1Rank, player2Rank, newChallengeDate) {
        const key = this.generateChallengeKey(player1Rank, player2Rank);
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

    async checkChallenge(player1Rank, player2Rank) {
        const key = this.generateChallengeKey(player1Rank, player2Rank);
        
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
    async markChallengeWarningAsSent(player1Rank, player2Rank) {
        const key = this.generateChallengeKey(player1Rank, player2Rank);
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

    async removeChallenge(player1Rank, player2Rank) {
        const key = this.generateChallengeKey(player1Rank, player2Rank);
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