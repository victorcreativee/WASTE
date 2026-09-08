"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemBootstrapStatus = systemBootstrapStatus;
exports.createFirstSystemAdmin = createFirstSystemAdmin;
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../config/database");
async function systemBootstrapStatus() { const r = await database_1.dbPool.query("SELECT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='system_admin') initialized"); return { setupRequired: !r.rows[0].initialized }; }
async function createFirstSystemAdmin(data) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wms:first-system-admin'))");
    const state = await c.query("SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='system_admin' LIMIT 1");
    if (state.rowCount)
        throw Object.assign(new Error('System setup is already complete. Sign in or use authenticated account management.'), { statusCode: 409 });
    if ((await c.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [data.email])).rowCount)
        throw Object.assign(new Error('That email already belongs to an account'), { statusCode: 409 });
    const hash = await bcrypt_1.default.hash(data.password, 12);
    const user = await c.query("INSERT INTO users(organization_id,full_name,email,password_hash,status) VALUES(NULL,$1,lower($2),$3,'active') RETURNING id,full_name,email", [data.fullName, data.email, hash]);
    const assigned = await c.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='system_admin' RETURNING user_id", [user.rows[0].id]);
    if (!assigned.rowCount)
        throw new Error('System roles are not initialized');
    await c.query('COMMIT');
    return user.rows[0];
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
