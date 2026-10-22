import { Page, queryPage } from '../utils/pagination';
import{dbPool}from'../config/database';

const listSql=`SELECT s.id,s.collection_job_id,s.scheduled_date,s.stop_order,s.status,s.arrived_at,s.completed_at,
 s.collected_weight_kg,s.completion_notes,s.evidence_url,s.exception_reason,s.exception_notes,s.exception_review_status,u.full_name customer_name,u.email customer_email,
 l.label location_label,l.address,l.zone_id,wz.name zone_name,c.contract_number,sp.name package_name,cj.driver_id,cj.job_date
 FROM customer_collection_stops s JOIN customer_profiles cp ON cp.id=s.customer_id JOIN users u ON u.id=cp.user_id
 JOIN customer_service_locations l ON l.id=s.service_location_id JOIN customer_contracts c ON c.id=s.contract_id
 JOIN customer_subscriptions sub ON sub.id=s.subscription_id JOIN service_plans sp ON sp.id=sub.plan_id
 JOIN collection_jobs cj ON cj.id=s.collection_job_id LEFT JOIN waste_zones wz ON wz.id=cj.zone_id`;
export async function findCustomerStops(organizationId:string|null,userId:string|null,jobId?:string,page?:Page){
 return queryPage(`${listSql} WHERE ($1::uuid IS NULL OR s.organization_id=$1::uuid)
  AND ($2::uuid IS NULL OR cp.user_id=$2::uuid) AND ($3::uuid IS NULL OR s.collection_job_id=$3::uuid)
  ORDER BY s.scheduled_date DESC,s.stop_order NULLS LAST,s.created_at,s.id`,[organizationId,userId,jobId??null],page);
}
export async function generateCustomerStops(jobId:string,organizationId:string){
 const client=await dbPool.connect();try{await client.query('BEGIN');
  const job=(await client.query(`SELECT id,organization_id,zone_id,job_date,status FROM collection_jobs
   WHERE id=$1 AND organization_id=$2 AND status IN ('pending','assigned') FOR UPDATE`,[jobId,organizationId])).rows[0];
  if(!job){await client.query('ROLLBACK');return null;}
  const result=await client.query(`INSERT INTO customer_collection_stops(organization_id,collection_job_id,relationship_id,
   customer_id,service_location_id,contract_id,subscription_id,scheduled_date,stop_order)
   SELECT $2,$1,eligible.relationship_id,eligible.customer_id,eligible.location_id,eligible.contract_id,
    eligible.subscription_id,$3,ROW_NUMBER() OVER(ORDER BY eligible.address,eligible.customer_id)
   FROM (SELECT DISTINCT ON(l.id) csr.id relationship_id,cp.id customer_id,l.id location_id,l.address,
     c.id contract_id,sub.id subscription_id
    FROM customer_service_relationships csr JOIN customer_profiles cp ON cp.id=csr.customer_id
    JOIN users u ON u.id=cp.user_id JOIN customer_service_locations l ON l.id=csr.service_location_id
    JOIN customer_contracts c ON c.customer_id=cp.id AND c.organization_id=csr.organization_id
     AND c.status IN ('active','expiring') AND c.starts_on<=$3 AND c.ends_on>=$3
    JOIN customer_subscriptions sub ON sub.id=c.subscription_id AND sub.customer_id=cp.id
     AND sub.organization_id=csr.organization_id AND sub.service_location_id=l.id AND sub.status='active' AND sub.starts_on<=$3
    JOIN service_plans sp ON sp.id=c.plan_id AND sp.id=sub.plan_id AND sp.organization_id=csr.organization_id AND sp.is_active
    WHERE csr.organization_id=$2 AND csr.status='active' AND l.zone_id=$4 AND cp.service_status='active' AND u.status='active'
     AND (sp.customer_type IS NULL OR sp.customer_type=cp.customer_type)
    ORDER BY l.id,c.starts_on DESC,c.created_at DESC) eligible
   ON CONFLICT(collection_job_id,service_location_id) DO NOTHING RETURNING *`,[job.id,organizationId,job.job_date,job.zone_id]);
  const total=(await client.query('SELECT count(*)::int count FROM customer_collection_stops WHERE collection_job_id=$1',[job.id])).rows[0].count;
  await client.query('COMMIT');return{job,created:result.rows.length,total,stops:result.rows};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}

export async function updateCustomerStop(id:string,userId:string,input:{action:'arrive'|'complete'|'skip';collectedWeightKg?:number;notes?:string;evidenceUrl?:string;exceptionReason?:string;exceptionNotes?:string}){
 const client=await dbPool.connect();try{await client.query('BEGIN');
  const found=await client.query(`SELECT s.*,cj.status job_status,crj.status route_stop_status,d.user_id driver_user_id FROM customer_collection_stops s
   JOIN collection_jobs cj ON cj.id=s.collection_job_id JOIN collection_route_jobs crj ON crj.job_id=cj.id JOIN drivers d ON d.id=cj.driver_id
   WHERE s.id=$1 FOR UPDATE OF s`,[id]);const stop=found.rows[0];
  if(!stop||stop.driver_user_id!==userId){await client.query('ROLLBACK');return null;}
  if(!['in_progress'].includes(stop.job_status))throw Object.assign(new Error('Start the assigned collection job before updating household stops'),{statusCode:409});
  const valid=input.action==='arrive'&&stop.route_stop_status==='arrived'&&stop.status==='pending'||input.action==='complete'&&stop.route_stop_status==='arrived'&&['pending','arrived'].includes(stop.status)||input.action==='skip'&&stop.route_stop_status==='arrived'&&['pending','arrived'].includes(stop.status);
  if(!valid)throw Object.assign(new Error('Household stop action is not valid from its current status'),{statusCode:409});
  const status=input.action==='arrive'?'arrived':input.action==='complete'?'completed':'skipped';
  const updated=await client.query(`UPDATE customer_collection_stops SET status=$2::varchar,arrived_at=CASE WHEN $2::varchar='arrived' THEN COALESCE(arrived_at,CURRENT_TIMESTAMP) ELSE arrived_at END,
   completed_at=CASE WHEN $2::varchar IN ('completed','skipped') THEN CURRENT_TIMESTAMP ELSE completed_at END,
   completed_by=CASE WHEN $2::varchar IN ('completed','skipped') THEN $3::uuid ELSE completed_by END,collected_weight_kg=COALESCE($4::numeric,collected_weight_kg),
   completion_notes=COALESCE($5::text,completion_notes),evidence_url=COALESCE($6::text,evidence_url),
   exception_reason=CASE WHEN $2::varchar='skipped' THEN $7::varchar ELSE exception_reason END,
   exception_notes=CASE WHEN $2::varchar='skipped' THEN $8::text ELSE exception_notes END,
   exception_review_status=CASE WHEN $2::varchar='skipped' THEN 'pending' ELSE exception_review_status END,
   updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING *`,
   [id,status,userId,input.collectedWeightKg??null,input.notes??null,input.evidenceUrl??null,input.exceptionReason??null,input.exceptionNotes??null]);
  await client.query('COMMIT');return updated.rows[0];
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}

export async function reviewCustomerStopException(id:string,organizationId:string,userId:string,input:{action:'resolve'|'reschedule';targetJobId?:string;reviewNotes:string}){
 const client=await dbPool.connect();try{await client.query('BEGIN');
  const stop=(await client.query(`SELECT s.*,l.zone_id FROM customer_collection_stops s JOIN customer_service_locations l ON l.id=s.service_location_id
   WHERE s.id=$1::uuid AND s.organization_id=$2::uuid AND s.status='skipped' AND s.exception_review_status='pending' FOR UPDATE OF s`,[id,organizationId])).rows[0];
  if(!stop){await client.query('ROLLBACK');return null;}
  let replacement=null;
  if(input.action==='reschedule'){
   const job=(await client.query(`SELECT id,job_date FROM collection_jobs WHERE id=$1::uuid AND organization_id=$2::uuid AND zone_id=$3::uuid
    AND status IN ('pending','assigned') AND job_date>=$4::date FOR UPDATE`,[input.targetJobId,organizationId,stop.zone_id,stop.scheduled_date])).rows[0];
   if(!job)throw Object.assign(new Error('Choose a pending or assigned job for the same zone on or after the original pickup date'),{statusCode:409});
   replacement=(await client.query(`INSERT INTO customer_collection_stops(organization_id,collection_job_id,relationship_id,customer_id,service_location_id,contract_id,subscription_id,scheduled_date,stop_order)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(stop_order),0)+1 FROM customer_collection_stops WHERE collection_job_id=$2))
    ON CONFLICT(collection_job_id,service_location_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP RETURNING *`,[organizationId,job.id,stop.relationship_id,stop.customer_id,stop.service_location_id,stop.contract_id,stop.subscription_id,job.job_date])).rows[0];
  }
  const updated=(await client.query(`UPDATE customer_collection_stops SET exception_review_status=$2::varchar,exception_notes=concat_ws(E'\n',exception_notes,$3::text),
   exception_reviewed_at=CURRENT_TIMESTAMP,exception_reviewed_by=$4::uuid,rescheduled_to_stop_id=$5::uuid,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING *`,
   [id,input.action==='resolve'?'resolved':'rescheduled',input.reviewNotes,userId,replacement?.id??null])).rows[0];
  await client.query('COMMIT');return{exception:updated,replacement};
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}}
