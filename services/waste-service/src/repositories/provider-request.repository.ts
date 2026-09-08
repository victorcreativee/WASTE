import {dbPool} from '../config/database';

type ReviewAction={action:'approve'|'reject';note?:string};
function conflict(message:string){throw Object.assign(new Error(message),{statusCode:409});}

const detailSql=`SELECT r.id,r.status,r.customer_note,r.review_note,r.created_at,r.updated_at,
  r.requested_organization_id,requested.name requested_organization_name,
  current.organization_id current_organization_id,current_org.name current_organization_name,
  cp.id customer_id,u.full_name customer_name,u.email customer_email,
  l.id service_location_id,l.address
 FROM customer_provider_requests r
 JOIN customer_profiles cp ON cp.id=r.customer_id JOIN users u ON u.id=cp.user_id
 JOIN customer_service_locations l ON l.id=r.service_location_id
 JOIN organizations requested ON requested.id=r.requested_organization_id
 LEFT JOIN customer_service_relationships current ON current.id=r.current_relationship_id
 LEFT JOIN organizations current_org ON current_org.id=current.organization_id`;

export async function providerOptions(userId:string){
 const result=await dbPool.query(`SELECT o.id,o.name,o.phone,COUNT(DISTINCT z.id)::int matching_zones
  FROM customer_profiles cp JOIN customer_service_locations l ON l.customer_id=cp.id AND l.is_primary
  JOIN waste_zones z ON z.is_active AND z.boundary IS NOT NULL AND ST_Covers(z.boundary,l.location::geometry)
  JOIN organizations o ON o.id=z.organization_id AND o.type='waste_collection_company' AND o.is_active
  LEFT JOIN customer_service_relationships current ON current.service_location_id=l.id AND current.status IN ('active','suspended')
  WHERE cp.user_id=$1::uuid AND o.id<>COALESCE(current.organization_id,'00000000-0000-0000-0000-000000000000'::uuid)
  GROUP BY o.id,o.name,o.phone ORDER BY o.name`,[userId]);
 return result.rows;
}

export async function customerProviderRequests(userId:string){
 const result=await dbPool.query(`${detailSql} WHERE cp.user_id=$1::uuid ORDER BY r.created_at DESC`,[userId]);
 return result.rows;
}

export async function organizationProviderRequests(organizationId:string){
 const result=await dbPool.query(`${detailSql} WHERE r.requested_organization_id=$1::uuid OR
  current.organization_id=$1::uuid ORDER BY CASE WHEN r.status LIKE 'pending_%' THEN 0 ELSE 1 END,r.created_at DESC`,[organizationId]);
 return result.rows.map(row=>({...row,organization_action:
  row.status==='pending_current_provider'&&row.current_organization_id===organizationId?'review_release':
  row.status==='pending_new_provider'&&row.requested_organization_id===organizationId?'review_acceptance':null}));
}

export async function createProviderRequest(userId:string,organizationId:string,note?:string){
 const client=await dbPool.connect();try{await client.query('BEGIN');
  const found=await client.query(`SELECT cp.id customer_id,l.id location_id,current.id relationship_id,current.organization_id
   FROM customer_profiles cp JOIN customer_service_locations l ON l.customer_id=cp.id AND l.is_primary
   LEFT JOIN customer_service_relationships current ON current.service_location_id=l.id AND current.status IN ('active','suspended')
   WHERE cp.user_id=$1::uuid FOR UPDATE OF l`,[userId]);
  const customer=found.rows[0];if(!customer)conflict('Save your primary service location before requesting a provider');
  if(customer.organization_id===organizationId)conflict('This organization is already your provider');
  const coverage=await client.query(`SELECT z.id FROM waste_zones z JOIN organizations o ON o.id=z.organization_id
   JOIN customer_service_locations l ON l.id=$2::uuid
   WHERE z.organization_id=$1::uuid AND z.is_active AND z.boundary IS NOT NULL AND o.is_active
    AND o.type='waste_collection_company' AND ST_Covers(z.boundary,l.location::geometry) ORDER BY z.id LIMIT 1`,[organizationId,customer.location_id]);
  if(!coverage.rowCount)conflict('The selected provider does not currently cover this service address');
  const result=await client.query(`INSERT INTO customer_provider_requests(customer_id,service_location_id,current_relationship_id,
   requested_organization_id,status,customer_note,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
   [customer.customer_id,customer.location_id,customer.relationship_id,organizationId,
    customer.relationship_id?'pending_current_provider':'pending_new_provider',note??null,userId]);
  await client.query('COMMIT');return result.rows[0];
 }catch(error){await client.query('ROLLBACK');if((error as{code?:string}).code==='23505')conflict('A provider request is already awaiting review');throw error;}finally{client.release();}}

export async function cancelProviderRequest(userId:string,id:string){
 const result=await dbPool.query(`UPDATE customer_provider_requests r SET status='cancelled',updated_at=CURRENT_TIMESTAMP
  FROM customer_profiles cp WHERE r.id=$1::uuid AND cp.id=r.customer_id AND cp.user_id=$2::uuid
   AND r.status IN ('pending_current_provider','pending_new_provider') RETURNING r.id,r.status`,[id,userId]);
 return result.rows[0]??null;
}

async function blockers(client:any,customerId:string,organizationId:string){
 const row=(await client.query(`SELECT
  EXISTS(SELECT 1 FROM customer_contracts WHERE customer_id=$1 AND organization_id=$2
   AND status IN ('draft','active','expiring','suspended')) open_contract,
  EXISTS(SELECT 1 FROM customer_subscriptions WHERE customer_id=$1 AND organization_id=$2
   AND status IN ('pending','active','suspended')) open_subscription,
  COALESCE((SELECT SUM(balance_ugx) FROM customer_invoices WHERE customer_id=$1 AND organization_id=$2
   AND status NOT IN ('paid','cancelled')),0)::bigint outstanding_balance,
  EXISTS(SELECT 1 FROM customer_payments WHERE customer_id=$1 AND organization_id=$2 AND status='pending') pending_payment`,
   [customerId,organizationId])).rows[0];return row;
}

export async function reviewProviderRequest(actorId:string,organizationId:string,id:string,input:ReviewAction){
 const client=await dbPool.connect();try{await client.query('BEGIN');
  const found=await client.query(`SELECT r.*,current.organization_id current_organization_id,current.status current_status,
   current.effective_from,l.location FROM customer_provider_requests r
   JOIN customer_service_locations l ON l.id=r.service_location_id
   LEFT JOIN customer_service_relationships current ON current.id=r.current_relationship_id
   WHERE r.id=$1::uuid FOR UPDATE OF r,l`,[id]);
  const request=found.rows[0];if(!request){await client.query('ROLLBACK');return null;}
  if(request.current_relationship_id){
   const locked=(await client.query('SELECT organization_id,status,effective_from FROM customer_service_relationships WHERE id=$1 FOR UPDATE',[request.current_relationship_id])).rows[0];
   if(!locked)conflict('The current provider relationship is no longer available');
   request.current_organization_id=locked.organization_id;request.current_status=locked.status;request.effective_from=locked.effective_from;
  }
  const isCurrent=request.status==='pending_current_provider'&&request.current_organization_id===organizationId;
  const isTarget=request.status==='pending_new_provider'&&request.requested_organization_id===organizationId;
  if(!isCurrent&&!isTarget){await client.query('ROLLBACK');return null;}
  if(input.action==='reject'){
   const rejected=await client.query(`UPDATE customer_provider_requests SET status='rejected',review_note=$2,
    final_reviewed_by=$3,final_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
    [id,input.note??null,actorId]);await client.query('COMMIT');return rejected.rows[0];
  }
  if(isCurrent){
   const blocked=await blockers(client,request.customer_id,organizationId);
   if(blocked.open_contract||blocked.open_subscription||blocked.pending_payment||BigInt(blocked.outstanding_balance)>0n)
    conflict(`Release blocked: close contracts and subscriptions, settle the UGX ${blocked.outstanding_balance} balance, and resolve pending payments first`);
   const advanced=await client.query(`UPDATE customer_provider_requests SET status='pending_new_provider',review_note=$2,
    current_provider_reviewed_by=$3,current_provider_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
    [id,input.note??null,actorId]);await client.query('COMMIT');return advanced.rows[0];
  }
  const coverage=await client.query(`SELECT z.id FROM waste_zones z JOIN organizations o ON o.id=z.organization_id
   JOIN customer_service_locations l ON l.id=$2::uuid
   WHERE z.organization_id=$1 AND z.is_active AND z.boundary IS NOT NULL AND o.is_active
    AND ST_Covers(z.boundary,l.location::geometry) ORDER BY z.id LIMIT 1`,[organizationId,request.service_location_id]);
  if(!coverage.rowCount)conflict('Approval blocked because this address is no longer inside active provider coverage');
  const live=await client.query(`SELECT id,organization_id,effective_from FROM customer_service_relationships
   WHERE service_location_id=$1 AND status IN ('active','suspended') FOR UPDATE`,[request.service_location_id]);
  const current=live.rows[0]??null;
  if(request.current_relationship_id&&current?.id!==request.current_relationship_id)conflict('The current provider changed while this request was under review');
  if(!request.current_relationship_id&&current)conflict('A provider was assigned while this request was under review');
  if(current){
   const blocked=await blockers(client,request.customer_id,current.organization_id);
   if(blocked.open_contract||blocked.open_subscription||blocked.pending_payment||BigInt(blocked.outstanding_balance)>0n)
    conflict('Approval blocked because obligations were created after provider release');
   await client.query(`UPDATE customer_service_relationships SET status='ended',effective_to=GREATEST(CURRENT_DATE,effective_from),
    ended_by=$2,ended_reason='Approved customer provider transfer',updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[current.id,actorId]);
  }
  await client.query(`INSERT INTO customer_service_relationships(customer_id,service_location_id,organization_id,status,
   relationship_source,effective_from,created_by) VALUES($1,$2,$3,'active',$4,CURRENT_DATE,$5)`,
   [request.customer_id,request.service_location_id,organizationId,current?'reviewed_transfer':'reviewed_link',actorId]);
  await client.query('UPDATE customer_service_locations SET organization_id=$2,zone_id=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1',
   [request.service_location_id,organizationId,coverage.rows[0].id]);
  await client.query("UPDATE customer_profiles SET service_status='active',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[request.customer_id]);
  const approved=await client.query(`UPDATE customer_provider_requests SET status='approved',review_note=$2,final_reviewed_by=$3,
   final_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[id,input.note??null,actorId]);
  await client.query('COMMIT');return approved.rows[0];
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
