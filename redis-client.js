// redis-client.js
const Redis = require('ioredis');
const { logError } = require('./logger');

class RedisClient {
    constructor() {
        // Debug environment variables related to Redis
        console.log('=== REDIS CLIENT DEBUG ===');
        Object.keys(process.env).filter(key => 
            key.includes('REDIS') || key.includes('SvS') || key.includes('SVS')
        ).forEach(key => {
            const value = process.env[key];
            console.log(`ENV ${key}: ${value ? (value.length > 20 ? value.substring(0, 3) + '...[redacted]' : value) : 'undefined'}`);
        });
        
        // Get specific Redis password
        const redisPassword = process.env.REDIS_PASSWORD;
        console.log(`Using REDIS_PASSWORD of length: ${redisPassword ? redisPassword.length : 0}`);
        
        // Hard-coded connection for Railway environment
        const connectionConfig = {
            host: 'shinkansen.proxy.rlwy.net',
            port: 51283,
            password: redisPassword, // Use exactly what's in the environment variable
            connectTimeout: 10000,
            retryStrategy: (times) => {
                const delay = Math.min(times * 100, 3000);
                console.log(`Redis retry attempt ${times} with delay ${delay}ms`);
                return delay;
            }
        };
        
        // Log configuration (without exposing full password)
        console.log('Redis connection config:', {
            ...connectionConfig,
            password: redisPassword ? `${redisPassword.substring(0, 3)}...` : 'undefined'
        });
        
        // Create Redis client
        this.client = new Redis(connectionConfig);

        // Debug events
        this.client.on('connect', () => {
            console.log('Redis client connected to server');
        });
        
        this.client.on('ready', () => {
            console.log('Redis client ready');
        });

        this.client.on('error', (err) => {
            console.error(`Redis client error: ${err.message}`);
            
            // Special debug for auth errors
            if (err.message.includes('WRONGPASS')) {
                console.error('Authentication failed. Trying with more debug info...');
                
                // Create a separate client to test auth manually
                const testClient = new Redis({
                    host: connectionConfig.host,
                    port: connectionConfig.port,
                    connectTimeout: 5000
                });
                
                testClient.on('connect', async () => {
                    console.log('Test connection established, trying AUTH command directly');
                    try {
                        await testClient.auth(redisPassword);
                        console.log('Direct AUTH succeeded!');
                    } catch (authErr) {
                        console.error(`Direct AUTH failed: ${authErr.message}`);
                    } finally {
                        testClient.disconnect();
                    }
                });
                
                testClient.on('error', (testErr) => {
                    console.error(`Test connection error: ${testErr.message}`);
                });
            }
            
            logError(`Redis Client Error: ${err.message}\nStack: ${err.stack}`);
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
            logError(`Error setting cooldown: ${error.message}\nStack: ${error.stack}`);
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
            logError(`Error checking cooldown: ${error.message}\nStack: ${error.stack}`);
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
            logError(`Error removing cooldown: ${error.message}\nStack: ${error.stack}`);
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
            logError(`Error listing cooldowns: ${error.message}\nStack: ${error.stack}`);
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
            logError(`Error getting player cooldowns: ${error.message}\nStack: ${error.stack}`);
            return [];
        }
    }
    
    // Simple ping method to check Redis connection
    async ping() {
        try {
            const result = await this.client.ping();
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = new RedisClient();