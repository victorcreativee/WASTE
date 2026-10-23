// Creates local preview accounts for each mobile workspace (one per role) in the local development database, so the app's
// screens can be reviewed without touching real users. Refuses to run against anything but a local database.
//
//   node scripts/seed-local-preview.cjs
//
// The generated password is written to services/auth-service/.env.preview (git-ignored, outside the Expo project so Metro
// never bundles it) as PREVIEW_PASSWORD; re-running keeps it.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const authDir = path.resolve(__dirname, "../../../services/auth-service");
require(path.join(authDir, "node_modules/dotenv")).config({ path: path.join(authDir, ".env"), quiet: true });
const bcrypt = require(path.join(authDir, "node_modules/bcrypt"));
const { Pool } = require(path.join(authDir, "node_modules/pg"));

const databaseUrl = process.env.DATABASE_URL || "";
if (!/(localhost|127\.0\.0\.1)/.test(databaseUrl)) throw new Error("Refusing to seed preview accounts outside the local database");

const secretsFile = path.join(authDir, ".env.preview");
const existing = fs.existsSync(secretsFile) ? fs.readFileSync(secretsFile, "utf8").match(/^PREVIEW_PASSWORD=(.+)$/m)?.[1] : null;
const password = existing || `Kw-${crypto.randomBytes(9).toString("base64url")}`;

const accounts = [
  { email: "preview.collector@kwms.test", name: "Preview Field Buyer", role: "recycling_collector", org: "recycling_company" },
  { email: "preview.sales@kwms.test", name: "Preview Industrial Sales", role: "recycling_sales", org: "recycling_company" },
  { email: "preview.manager@kwms.test", name: "Preview Field Manager", role: "recycling_field_manager", org: "recycling_company" },
  { email: "preview.driver@kwms.test", name: "Preview Driver", role: "driver", org: "waste_collection_company" },
  { email: "preview.supervisor@kwms.test", name: "Preview Supervisor", role: "supervisor", org: "waste_collection_company" },
  { email: "preview.admin@kwms.test", name: "Preview Company Admin", role: "company_admin", org: "waste_collection_company" },
];

(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const hash = await bcrypt.hash(password, 12);
  for (const account of accounts) {
    // The local company of that type with the most active staff (the one used for development).
    const org = (await pool.query(
      `SELECT o.id FROM organizations o WHERE o.is_active AND o.type=$1
       ORDER BY (SELECT COUNT(*) FROM users u WHERE u.organization_id=o.id AND u.status='active') DESC LIMIT 1`, [account.org])).rows[0];
    if (!org) { console.log(`skipped ${account.email}: no local ${account.org}`); continue; }
    const user = (await pool.query(
      `INSERT INTO users(organization_id,full_name,email,password_hash,status) VALUES($1,$2,$3,$4,'active')
       ON CONFLICT(email) DO UPDATE SET organization_id=EXCLUDED.organization_id,full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,status='active',updated_at=CURRENT_TIMESTAMP
       RETURNING id`, [org.id, account.name, account.email, hash])).rows[0];
    await pool.query("DELETE FROM user_roles WHERE user_id=$1", [user.id]);
    await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2", [user.id, account.role]);
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'", [org.id, user.id])
      .catch(() => undefined);
    if (account.role === "driver") {
      await pool.query(
        `INSERT INTO drivers(organization_id,user_id,full_name,status) SELECT $1,$2,$3,'available' WHERE NOT EXISTS(SELECT 1 FROM drivers WHERE user_id=$2)`,
        [org.id, user.id, account.name]);
    }
    console.log(`ready ${account.email} (${account.role})`);
  }
  await pool.end();
  fs.writeFileSync(secretsFile, `# Local preview accounts (scripts/seed-local-preview.cjs). Local database only.\nPREVIEW_PASSWORD=${password}\n`, { mode: 0o600 });
  console.log(`Password saved in ${path.relative(process.cwd(), secretsFile)}`);
})().catch(error => { console.error(error); process.exit(1); });
