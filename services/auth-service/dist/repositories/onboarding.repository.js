"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueAdminInvitation = issueAdminInvitation;
exports.revokeAdminInvitation = revokeAdminInvitation;
exports.onboardingStatus = onboardingStatus;
exports.acceptAdminInvitation = acceptAdminInvitation;
const crypto_1 = require("crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../config/database");
const failure = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const digest = (token) => (0, crypto_1.createHash)('sha256').update(token).digest('hex');
const unavailable = () => failure('This setup link is unavailable, expired or already used. Ask the issuing administrator for help.', 400);
async function platformActor(client, actor) {
    const result = await client.query(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
 WHERE u.id=$1::uuid AND u.status='active' AND r.name='system_admin'`, [actor]);
    if (!result.rowCount)
        throw failure('Platform organization administration is required', 403);
}
async function company(client, org) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`access:${org}`]);
    const result = await client.query("SELECT id,name FROM organizations WHERE id=$1::uuid AND is_active AND type='waste_collection_company' FOR UPDATE", [org]);
    if (!result.rowCount)
        throw failure('An active waste-collection company is required', 404);
    const admin = await client.query(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
 WHERE u.organization_id=$1::uuid AND r.name='company_admin'`, [org]);
    if (admin.rowCount)
        throw failure('This company already has an administrator. First-admin setup cannot replace or recover an existing account.');
    return result.rows[0];
}
async function audit(client, org, actor, action, id, data) {
    await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value)
 VALUES($1::uuid,$2::uuid,$3,'admin_invitation',$4::uuid,$5::jsonb)`, [org, actor, action, id, JSON.stringify(data)]);
}
async function issueAdminInvitation(org, actor, email) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        await platformActor(client, actor);
        await company(client, org);
        const existing = await client.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
        if (existing.rowCount)
            throw failure('Use a new administrator email. Existing accounts cannot be transferred through setup.');
        const old = await client.query(`UPDATE organization_admin_invitations SET revoked_at=CURRENT_TIMESTAMP WHERE organization_id=$1::uuid AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [org]);
        for (const row of old.rows)
            await audit(client, org, actor, 'invitation_replaced', row.id, {});
        const token = (0, crypto_1.randomBytes)(32).toString('hex');
        const result = await client.query(`INSERT INTO organization_admin_invitations(organization_id,email,token_hash,issued_by,expires_at)
   VALUES($1::uuid,lower($2),$3,$4::uuid,CURRENT_TIMESTAMP+INTERVAL '24 hours') RETURNING id,email,expires_at`, [org, email, digest(token), actor]);
        await audit(client, org, actor, 'invitation_issued', result.rows[0].id, { expires_at: result.rows[0].expires_at });
        await client.query('COMMIT');
        return { ...result.rows[0], token };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function revokeAdminInvitation(org, actor, id) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        await platformActor(client, actor);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`access:${org}`]);
        const result = await client.query(`UPDATE organization_admin_invitations SET revoked_at=CURRENT_TIMESTAMP
   WHERE id=$1::uuid AND organization_id=$2::uuid AND revoked_at IS NULL AND accepted_at IS NULL RETURNING id`, [id, org]);
        if (!result.rowCount)
            throw failure('Pending invitation not found', 404);
        await audit(client, org, actor, 'invitation_revoked', id, {});
        await client.query('COMMIT');
        return { id };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function onboardingStatus(org) {
    const organization = await database_1.dbPool.query("SELECT id FROM organizations WHERE id=$1::uuid AND type='waste_collection_company'", [org]);
    if (!organization.rowCount)
        throw failure('Company not found', 404);
    const admin = await database_1.dbPool.query("SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.organization_id=$1::uuid AND r.name='company_admin'", [org]);
    const invitations = await database_1.dbPool.query(`SELECT id,email,created_at,expires_at,revoked_at,accepted_at,expires_at<=CURRENT_TIMESTAMP AS expired FROM organization_admin_invitations
 WHERE organization_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 10`, [org]);
    return { hasAdministrator: !!admin.rowCount, invitations: invitations.rows };
}
async function acceptAdminInvitation(token, email, fullName, password) {
    // Hash before taking the organization lock; routes also bound request rate and input size.
    const passwordHash = await bcrypt_1.default.hash(password, 12);
    const client = await database_1.dbPool.connect();
    try {
        await client.query('BEGIN');
        const lookup = await client.query('SELECT organization_id FROM organization_admin_invitations WHERE token_hash=$1', [digest(token)]);
        if (!lookup.rowCount)
            throw unavailable();
        const org = lookup.rows[0].organization_id;
        try {
            await company(client, org);
        }
        catch {
            throw unavailable();
        }
        const result = await client.query(`SELECT * FROM organization_admin_invitations WHERE token_hash=$1 AND lower(email)=lower($2)
   AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE`, [digest(token), email]);
        if (!result.rowCount)
            throw unavailable();
        const invitation = result.rows[0];
        const exists = await client.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
        if (exists.rowCount)
            throw unavailable();
        const adminRole = await client.query("SELECT id FROM roles WHERE name='company_admin'");
        if (!adminRole.rowCount)
            throw failure('Administrator setup is not configured', 503);
        const user = await client.query(`INSERT INTO users(organization_id,full_name,email,password_hash) VALUES($1::uuid,$2,lower($3),$4) RETURNING id`, [org, fullName, email, passwordHash]);
        const id = user.rows[0].id;
        await client.query("SELECT set_config('wms.actor_id',$1,true)", [id]);
        await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1::uuid,$2::uuid)', [id, adminRole.rows[0].id]);
        await client.query('UPDATE organization_admin_invitations SET accepted_at=CURRENT_TIMESTAMP,accepted_user_id=$2::uuid WHERE id=$1::uuid', [invitation.id, id]);
        await audit(client, org, id, 'invitation_accepted', invitation.id, { user_id: id });
        await client.query('COMMIT');
        return { message: 'Administrator account created. Sign in with your email and password.' };
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505')
            throw unavailable();
        throw error;
    }
    finally {
        client.release();
    }
}
