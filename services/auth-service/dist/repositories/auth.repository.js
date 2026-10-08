"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByEmail = findUserByEmail;
exports.createUser = createUser;
exports.createOrganizationApplicant = createOrganizationApplicant;
exports.updateLastLogin = updateLastLogin;
exports.findUserById = findUserById;
const database_1 = require("../config/database");
async function findUserByEmail(email) {
    const result = await database_1.dbPool.query(`
    SELECT 
      id,
      organization_id,
      full_name,
      email,
      phone,
      password_hash,
      status,
      created_at
    FROM users
    WHERE email = $1
    LIMIT 1
    `, [email.toLowerCase()]);
    return result.rows[0] ?? null;
}
async function createUser(data) {
    const result = await database_1.dbPool.query(`
    INSERT INTO users (
      organization_id,
      full_name,
      email,
      phone,
      password_hash
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING 
      id,
      organization_id,
      full_name,
      email,
      phone,
      password_hash,
      status,
      created_at
    `, [
        data.organizationId ?? null,
        data.fullName,
        data.email.toLowerCase(),
        data.phone ?? null,
        data.passwordHash,
    ]);
    return result.rows[0];
}
async function createOrganizationApplicant(data, passwordHash) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const exists = await client.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [data.email]);
        if (exists.rowCount)
            throw Object.assign(new Error("Email is already registered"), { statusCode: 409 });
        const registration = await client.query("SELECT 1 FROM organization_applicant_profiles WHERE lower(registration_number)=lower($1)", [data.registrationNumber]);
        if (registration.rowCount)
            throw Object.assign(new Error("This company registration number already has an onboarding account"), { statusCode: 409 });
        const user = await client.query(`INSERT INTO users(organization_id,full_name,email,phone,password_hash,status) VALUES(NULL,$1,lower($2),$3,$4,'active') RETURNING id,organization_id,full_name,email,phone,password_hash,status,created_at`, [data.fullName, data.email, data.phone, passwordHash]);
        const role = await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='organization_applicant' RETURNING user_id", [user.rows[0].id]);
        if (!role.rowCount)
            throw Object.assign(new Error("Applicant registration is not configured"), { statusCode: 503 });
        await client.query("INSERT INTO organization_applicant_profiles(user_id,company_name,registration_number,company_type) VALUES($1,$2,$3,$4)", [user.rows[0].id, data.companyName, data.registrationNumber, data.companyType]);
        await client.query("COMMIT");
        return user.rows[0];
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function updateLastLogin(userId) {
    await database_1.dbPool.query(`
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `, [userId]);
}
async function findUserById(userId) {
    const result = await database_1.dbPool.query(`
      SELECT 
        id,
        organization_id,
        full_name,
        email,
        phone,
        password_hash,
        status,
        created_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `, [userId]);
    return result.rows[0] ?? null;
}
