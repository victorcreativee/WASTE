"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbPool = void 0;
exports.checkDatabaseHealth = checkDatabaseHealth;
const pg_1 = require("pg");
const env_1 = require("./env");
exports.dbPool = new pg_1.Pool({
    connectionString: env_1.env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
async function checkDatabaseHealth() {
    const result = await exports.dbPool.query("SELECT NOW() AS current_time");
    return {
        connected: true,
        currentTime: result.rows[0].current_time,
    };
}
