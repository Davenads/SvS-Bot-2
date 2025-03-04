// redis-client.js
const Redis = require('ioredis');
const { logError } = require('./logger');

class RedisClient {
    constructor() {
        this.isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';
        
        // Determine if we're in Railway's environment
        console.log(`Redis Client Initialization:`);
        console.log(`- Environment detection: RAILWAY_ENVIRONMENT=${process.env.RAILWAY_ENVIRONMENT}`);
        console.log(`- Available env vars: REDIS_HOST=${process.env.REDIS_HOST}, REDIS_PORT=${process.env.REDIS_PORT}`);
        
        const connectionInfo = this.getConnectionInfo();
        
        console.log(`- Environment resolved as: ${this.isRailway ? 'Railway' : 'Local'}`);
        console.log(`- Selected host: ${connectionInfo.host}`);
        console.log(`- Selected port: ${connectionInfo.port}`);
        console.log(`- Password length: ${connectionInfo.password ? connectionInfo.password.length : 0}`);
        console.log(`- Using internal networking: ${connectionInfo.useInternalNetworking}`);
        
        // Initialize Redis connection
        const redisOptions = {
            host: connectionInfo.host,
            port: connectionInfo.port,
            password: connectionInfo.password,
            retryStrategy: (times) => {
                const delay = Math.min(times * 100, 3000);
                console.log(`Redis retry attempt ${times} with delay ${delay}ms`);
                return delay;
            },
            maxRetriesPerRequest: 3,
            connectTimeout: 10000, // 10 seconds
            enableOfflineQueue: false // Disable offline queue for faster failure detection
        };
        
        this.client = new Redis(redisOptions);

        this.client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            logError(`Redis Client Error: ${err.message}\nStack: ${err.stack}`);
        });

        this.client.on('connect', () => {
            console.log('Redis Client Connected Successfully');
        });
        
        this.client.on('reconnecting', () => {
            console.log('Redis Client Reconnecting...');
        });
    }
    
    // Helper method to determine connection info based on environment
    getConnectionInfo() {
        // Force Railway proxy connection for testing
        console.log('Environment variables for Redis connection:');
        console.log(`REDIS_HOST: ${process.env.REDIS_HOST || 'not set'}`);
        console.log(`REDIS_PORT: ${process.env.REDIS_PORT || 'not set'}`);
        console.log(`REDIS_PASSWORD length: ${process.env.REDIS_PASSWORD ? process.env.REDIS_PASSWORD.length : 0}`);
        console.log(`RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT || 'not set'}`);
        
        // Railway environment - hardcoded connection to your specific instance
        if (process.env.RAILWAY_ENVIRONMENT || 
            process.env.RAILWAY_SERVICE_NAME || 
            process.env.RAILWAY_STATIC_URL) {
            console.log('Using Railway Redis connection with direct password');
            
            return {
                host: 'shinkansen.proxy.rlwy.net',
                port: 51283,
                // Get password directly from environment, no processing
                password: process.env.REDIS_PASSWORD,
                useInternalNetworking: false
            };
        }
        
        // Local development fallback
        console.log('Falling back to local development Redis connection');
        return {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            useInternalNetworking: false
        };
    }

    // Health check method - useful for verifying connection
    async pingRedis() {
        try {
            const response = await this.client.ping();
            return { success: true, response };
        } catch (error) {
            logError(`Redis ping failed: ${error.message}`);
            return { success: false, error: error.message };
        }
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
}

module.exports = new RedisClient();