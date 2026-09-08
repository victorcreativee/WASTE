import { dbPool } from '../config/database';
import { z } from 'zod';
import { attendanceSchema } from '../validators/attendance.validator';

export async function findAttendance(organizationId:string,workDate:string) {
 const result=await dbPool.query(`SELECT a.*,u.full_name,u.email,ARRAY_REMOVE(ARRAY_AGG(DISTINCT roles.name),NULL) roles
 FROM staff_attendance a JOIN users u ON u.id=a.user_id AND u.organization_id=a.organization_id
 LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles ON roles.id=ur.role_id
 WHERE a.organization_id=$1::uuid AND a.work_date=$2::date GROUP BY a.id,u.id ORDER BY a.shift_start NULLS LAST,u.full_name`,[organizationId,workDate]);
 return result.rows;
}

export async function saveAttendance(organizationId:string,recordedBy:string,data:z.infer<typeof attendanceSchema>) {
 const client=await dbPool.connect();
 try {
  await client.query('BEGIN');
  // Serialize permission changes with the permission check and attendance write.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`access:${organizationId}`]);
  const allowed=await client.query("SELECT 1 FROM organization_effective_permissions($1::uuid,$2::uuid) WHERE code='attendance.manage'",[recordedBy,organizationId]);
  if(!allowed.rowCount)throw Object.assign(new Error('Your role does not permit recording attendance'),{statusCode:403});
  const target=await client.query(`SELECT u.id FROM users u
   JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id AND m.status='active'
   WHERE u.id=$1::uuid AND u.organization_id=$2::uuid AND u.status='active'
    AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('driver','supervisor','iot_operator'))
    AND NOT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('company_admin','citizen','kcca_admin','system_admin'))
   FOR UPDATE OF u,m`,[data.userId,organizationId]);
  if(!target.rowCount){await client.query('ROLLBACK');return null;}
  const previous=await client.query('SELECT * FROM staff_attendance WHERE organization_id=$1::uuid AND user_id=$2::uuid AND work_date=$3::date FOR UPDATE',[organizationId,data.userId,data.workDate]);
  const result=await client.query(`INSERT INTO staff_attendance(organization_id,user_id,work_date,shift_name,shift_start,shift_end,status,checked_in_at,checked_out_at,notes,recorded_by)
   VALUES($1::uuid,$2::uuid,$3::date,$4,$5::time,$6::time,$7::text,CASE WHEN $7::text IN ('present','late') THEN CURRENT_TIMESTAMP END,NULL,$8,$9::uuid)
   ON CONFLICT(organization_id,user_id,work_date) DO UPDATE SET shift_name=EXCLUDED.shift_name,shift_start=EXCLUDED.shift_start,shift_end=EXCLUDED.shift_end,status=EXCLUDED.status,
    checked_in_at=CASE WHEN EXCLUDED.status IN ('present','late') THEN COALESCE(staff_attendance.checked_in_at,CURRENT_TIMESTAMP) ELSE staff_attendance.checked_in_at END,
    notes=EXCLUDED.notes,recorded_by=EXCLUDED.recorded_by,updated_at=CURRENT_TIMESTAMP RETURNING *`,
   [organizationId,data.userId,data.workDate,data.shiftName,data.shiftStart??null,data.shiftEnd??null,data.status,data.notes??null,recordedBy]);
  // Do not copy free-text notes or unrelated personal data into the access audit.
  const snapshot=(row:Record<string,unknown>|undefined)=>row?{user_id:row.user_id,work_date:row.work_date,shift_name:row.shift_name,shift_start:row.shift_start,shift_end:row.shift_end,status:row.status}:null;
  await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,previous_value,new_value)
   VALUES($1::uuid,$2::uuid,'attendance_recorded','staff_attendance',$3::uuid,$4::jsonb,$5::jsonb)`,
   [organizationId,recordedBy,result.rows[0].id,JSON.stringify(snapshot(previous.rows[0])),JSON.stringify(snapshot(result.rows[0]))]);
  await client.query('COMMIT');return result.rows[0];
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
