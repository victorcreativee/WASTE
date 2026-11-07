import { dbPool } from "../config/database";
import { normaliseSettings, resolveSettings, settingsSchema, type RecyclingSettings } from "../services/recycling-settings";
import { z } from "zod";

type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export async function getSettings(q: Client, org: string): Promise<RecyclingSettings> {
  const row = (await q.query(`SELECT settings FROM recycling_company_settings WHERE organization_id=$1::uuid`, [org])).rows[0];
  return resolveSettings(row?.settings ?? {});
}

/**
 * Refuses an expense category or quality grade the company has not turned on. A record being edited may keep the
 * value it already has, even if that value has since been turned off.
 */
export async function assertOption(q: Client, org: string, kind: "expenseCategories" | "qualityGrades", code: string, current?: string) {
  if (current !== undefined && code === current) return;
  const found = (await getSettings(q, org))[kind].find(o => o.code === code);
  if (!found?.active) throw badRequest(`Choose ${kind === "expenseCategories" ? "an expense category" : "a quality grade"} from the list. "${code}" is not turned on in Recycling settings.`);
}

/** Saves the administrator's changes and keeps the before and after settings in the corrections history. */
export async function saveSettings(org: string, user: string, input: unknown) {
  const parsed = settingsSchema.parse(input);
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    const stored = (await c.query(`SELECT settings FROM recycling_company_settings WHERE organization_id=$1::uuid FOR UPDATE`, [org])).rows[0]?.settings ?? {};
    const before = resolveSettings(stored), change = normaliseSettings(parsed, before);
    const merged = { ...stored, ...change, ...(change.costFields && { costFields: { ...(stored.costFields ?? {}), ...change.costFields } }), ...(change.rules && { rules: { ...(stored.rules ?? {}), ...change.rules } }) };
    await c.query(`INSERT INTO recycling_company_settings(organization_id,settings,updated_by,updated_at)VALUES($1,$2::jsonb,$3,now())
      ON CONFLICT(organization_id) DO UPDATE SET settings=EXCLUDED.settings,updated_by=EXCLUDED.updated_by,updated_at=now()`, [org, JSON.stringify(merged), user]);
    const after = resolveSettings(merged);
    const changed = (Object.keys(change) as Array<keyof RecyclingSettings>).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (changed.length) await c.query(`INSERT INTO recycling_transaction_edits(organization_id,transaction_type,transaction_id,before_state,after_state,edited_by)VALUES($1,'settings_change',$1,$2::jsonb,$3::jsonb,$4)`,
      [org, JSON.stringify(Object.fromEntries(changed.map(k => [k, before[k]]))), JSON.stringify(Object.fromEntries(changed.map(k => [k, after[k]]))), user]);
    await c.query("COMMIT");
    return { settings: after, changed };
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

export const renameSchema = z.object({ name: z.string().trim().min(2).max(80), reason: z.string().trim().min(5).max(300) });

/**
 * Renames a material everywhere it is used, including past stock and sorting records, and keeps the old name working
 * when someone types it. Renaming to a name that already exists merges the two materials.
 */
export async function renameMaterial(org: string, user: string, id: string, input: unknown) {
  const { name, reason } = renameSchema.parse(input);
  const c = await dbPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recycling-finance:${org}`]);
    const material = (await c.query(`SELECT * FROM recycling_material_catalog WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`, [id, org])).rows[0];
    if (!material) throw Object.assign(new Error("Material not found"), { statusCode: 404 });
    const target = (await c.query(`SELECT * FROM recycling_material_catalog WHERE organization_id=$1::uuid AND recycling_material_key(name)=recycling_material_key($2) AND id<>$3::uuid FOR UPDATE`, [org, name, id])).rows[0];
    if (material.name === name) throw badRequest("The new name is the same as the old one");
    const newName = target?.name ?? name;
    // Only the name changes on past rows, so the closed-day lock lets it through for this transaction.
    await c.query(`SELECT set_config('kwms.material_rename','on',true)`);
    const lots = (await c.query(`UPDATE recycling_material_lots SET material_type=$3,updated_at=now() WHERE organization_id=$1::uuid AND material_type=$2 RETURNING id`, [org, material.name, newName])).rowCount;
    const sorted = (await c.query(`UPDATE recycling_sorting_batches SET output_material_type=$3 WHERE organization_id=$1::uuid AND output_material_type=$2`, [org, material.name, newName])).rowCount;
    await c.query(`UPDATE recycling_material_transfers SET from_material=CASE WHEN from_material=$2 THEN $3 ELSE from_material END,to_material=CASE WHEN to_material=$2 THEN $3 ELSE to_material END WHERE organization_id=$1::uuid AND $2 IN(from_material,to_material)`, [org, material.name, newName]);
    await c.query(`SELECT set_config('kwms.material_rename','off',true)`);
    if (target) {
      await c.query(`UPDATE recycling_material_catalog SET active=true,updated_at=now() WHERE id=$1::uuid`, [target.id]);
      await c.query(`DELETE FROM recycling_material_catalog WHERE id=$1::uuid`, [id]);
    } else {
      await c.query(`UPDATE recycling_material_catalog SET name=$2,updated_at=now() WHERE id=$1::uuid`, [id, newName]);
    }
    await c.query(`UPDATE recycling_material_aliases SET material=$3 WHERE organization_id=$1::uuid AND material=$2`, [org, material.name, newName]);
    // The new name is a real material now, so it must not still point somewhere else as an old name.
    await c.query(`DELETE FROM recycling_material_aliases WHERE organization_id=$1::uuid AND alias_key=recycling_material_key($2)`, [org, newName]);
    await c.query(`INSERT INTO recycling_material_aliases(organization_id,alias_key,alias,material)VALUES($1,recycling_material_key($2),$2,$3) ON CONFLICT(organization_id,alias_key) DO UPDATE SET material=EXCLUDED.material`, [org, material.name, newName]);
    await c.query(`INSERT INTO recycling_transaction_edits(organization_id,transaction_type,transaction_id,before_state,after_state,edited_by)VALUES($1,'material_rename',$2,$3::jsonb,$4::jsonb,$5)`,
      [org, id, JSON.stringify({ material: material.name }), JSON.stringify({ material: newName, merged: Boolean(target), lots, sortingRows: sorted, reason }), user]);
    await c.query("COMMIT");
    return { from: material.name, to: newName, merged: Boolean(target), lots };
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
