import { dbPool } from "../config/database";
import type { OrganizationApplicantRegisterInput } from "../validators/auth.validator";

export type UserRecord = {
  id: string;
  organization_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  status: string;
  created_at: Date;
};

export async function findUserByEmail(
  email: string
): Promise<UserRecord | null> {
  const result = await dbPool.query(
    `
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
    `,
    [email.toLowerCase()]
  );

  return result.rows[0] ?? null;
}

export async function createUser(data: {
  organizationId?: string;
  fullName: string;
  email: string;
  phone?: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const result = await dbPool.query(
    `
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
    `,
    [
      data.organizationId ?? null,
      data.fullName,
      data.email.toLowerCase(),
      data.phone ?? null,
      data.passwordHash,
    ]
  );

  return result.rows[0];
}

export async function createOrganizationApplicant(data:OrganizationApplicantRegisterInput,passwordHash:string):Promise<UserRecord>{
  const client=await dbPool.connect();
  try{
    await client.query("BEGIN");
    const exists=await client.query("SELECT 1 FROM users WHERE lower(email)=lower($1)",[data.email]);
    if(exists.rowCount)throw Object.assign(new Error("Email is already registered"),{statusCode:409});
    const registration=await client.query("SELECT 1 FROM organization_applicant_profiles WHERE lower(registration_number)=lower($1)",[data.registrationNumber]);
    if(registration.rowCount)throw Object.assign(new Error("This company registration number already has an onboarding account"),{statusCode:409});
    const user=await client.query(`INSERT INTO users(organization_id,full_name,email,phone,password_hash,status) VALUES(NULL,$1,lower($2),$3,$4,'active') RETURNING id,organization_id,full_name,email,phone,password_hash,status,created_at`,[data.fullName,data.email,data.phone,passwordHash]);
    const role=await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='organization_applicant' RETURNING user_id",[user.rows[0].id]);
    if(!role.rowCount)throw Object.assign(new Error("Applicant registration is not configured"),{statusCode:503});
    await client.query("INSERT INTO organization_applicant_profiles(user_id,company_name,registration_number,company_type) VALUES($1,$2,$3,$4)",[user.rows[0].id,data.companyName,data.registrationNumber,data.companyType]);
    await client.query("COMMIT");return user.rows[0];
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function updateLastLogin(userId: string) {
  await dbPool.query(
    `
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [userId]
  );
}
export async function updatePasswordHash(userId:string,passwordHash:string){await dbPool.query("UPDATE users SET password_hash=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1",[userId,passwordHash]);}
export async function findUserById(userId: string): Promise<UserRecord | null> {
  const result = await dbPool.query(
    `
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
      `,
    [userId]
  );

  return result.rows[0] ?? null;
}
