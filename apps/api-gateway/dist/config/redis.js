"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = void 0;
exports.connectRedis = connectRedis;
exports.checkRedisHealth = checkRedisHealth;
const redis_1 = require("redis");
const env_1 = require("./env");
exports.redisClient = (0, redis_1.createClient)({
    url: env_1.env.redisUrl,
});
exports.redisClient.on("error", (error) => {
    console.error("Redis error:", error);
});
let isRedisConnected = false;
async function connectRedis() {
    if (!isRedisConnected) {
        await exports.redisClient.connect();
        isRedisConnected = true;
    }
}
async function checkRedisHealth() {
    await connectRedis();
    const pong = await exports.redisClient.ping();
    return {
        connected: pong === "PONG",
        response: pong,
    };
}
