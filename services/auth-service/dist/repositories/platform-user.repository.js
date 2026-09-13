"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPlatformUsers = listPlatformUsers;
exports.createPlatformUser = createPlatformUser;
exports.changePlatformUserStatus = changePlatformUserStatus;
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../config/database");
async function listPlatformUsers() { const users = await database_1.dbPool.query(`SELECT u.id,u.full_name,u.email,u.phone,u.status,u.last_login_at,u.created_at,r.name role,o.name organization_name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id LEFT JOIN organizations o ON o.id=u.organization_id WHERE r.name IN('system_admin','kcca_admin','weighbridge_operator') ORDER BY CASE r.name WHEN 'system_admin' THEN 0 WHEN 'kcca_admin' THEN 1 ELSE 2 END,u.full_name`); const events = await database_1.dbPool.query(`SELECT e.id,e.action,e.target_user_id,e.details,e.created_at,a.full_name actor_name,t.full_name target_name FROM platform_administration_events e JOIN users a ON a.id=e.actor_id LEFT JOIN users t ON t.id=e.target_user_id ORDER BY e.created_at DESC LIMIT 100`); return { users: users.rows, events: events.rows }; }
async function createPlatformUser(actorId, data) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wms:platform-users'))");
    if ((await c.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [data.email])).rowCount)
        throw Object.assign(new Error('That email already belongs to an account'), { statusCode: 409 });
    const kccaRole = ['kcca_admin', 'weighbridge_operator'].includes(data.role), org = kccaRole ? (await c.query("SELECT id FROM organizations WHERE type='kcca' AND is_active ORDER BY created_at LIMIT 1")).rows[0] : null;
    if (kccaRole && !org)
        throw new Error('Active KCCA organization is missing');
    const hash = await bcrypt_1.default.hash(data.password, 12);
    const user = await c.query("INSERT INTO users(organization_id,full_name,email,phone,password_hash,status) VALUES($1,$2,lower($3),$4,$5,'active') RETURNING id,full_name,email,phone,status,created_at", [org?.id || null, data.fullName, data.email, data.phone || null, hash]);
    const role = await c.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 RETURNING user_id', [user.rows[0].id, data.role]);
    if (!role.rowCount)
        throw new Error('Platform role is unavailable');
    await c.query(`INSERT INTO platform_administration_events(actor_id,action,target_user_id,details) VALUES($1,'platform_user_created',$2,$3::jsonb)`, [actorId, user.rows[0].id, JSON.stringify({ role: data.role, email: data.email.toLowerCase() })]);
    await c.query('COMMIT');
    return { ...user.rows[0], role: data.role };
}
catch (e) {
    await c.query('ROLLBACK');
    throw e;
}
finally {
    c.release();
} }
async function changePlatformUserStatus(actorId, targetId, status) { const c = await database_1.dbPool.connect(); try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wms:platform-users'))");
    if (actorId === targetId && status !== 'active')
        throw Object.assign(new Error('You cannot suspend your own signed-in account'), { statusCode: 409 });
    const target = (await c.query(`SELECT u.id,u.status,r.name role FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=$1 AND r.name IN('system_admin','kcca_admin','weighbridge_operator') FOR UPDATE OF u`, [targetId])).rows[0];
    if (!target) {
        await c.query('ROLLBACK');
        return null;
    }
    if (target.role === 'system_admin' && status !== 'active') {
        const count = await c.query(`SELECT COUNT(DISTINCT u.id)::int total FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='system_admin' AND u.status='active'`);
        if (count.rows[0].total <= 1)
            throw Object.assign(new Error('The last active System Admin cannot be suspended'), { statusCode: 409 });
    }
    const user = await c.query('UPDATE users SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,full_name,email,status', [targetId, status]);
    await c.query(`INSERT INTO platform_administration_events(actor_id,action,target_user_id,details) VALUES($1,'platform_user_status_changed',$2,$3::jsonb)`, [actorId, targetId, JSON.stringify({ previousStatus: target.status, status, role: target.role })]);
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
