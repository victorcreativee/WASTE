import {dbPool} from '../config/database';

type ReviewAction={action:'approve'|'reject';note?:string;zoneId?:string};
function conflict(message:string){throw Object.assign(new Error(message),{statusCode:409});}

const detailSql=`SELECT r.id,r.status,r.customer_note,r.review_note,r.created_at,r.updated_at,
  r.requested_organization_id,requested.name requested_organization_name,requested.phone requested_organization_phone,
  current.organization_id current_organization_id,current_org.name current_organization_name,
  cp.id customer_id,cp.customer_type,u.full_name customer_name,
  CASE WHEN u.email LIKE '%.invalid' THEN NULL ELSE u.email END customer_email,u.phone customer_phone,
  l.id service_location_id,l.address,l.location_precise,division.name division_name,area.name area_name,
  ST_Y(l.location::geometry) latitude,ST_X(l.location::geometry) longitude,
  (SELECT rc.match FROM recommended_collectors(l.division_id,l.catalog_area_id,l.location,l.location_precise) rc
    WHERE rc.organization_id=r.requested_organization_id) match,
  (SELECT rc.zone_id FROM recommended_collectors(l.division_id,l.catalog_area_id,l.location,l.location_precise) rc
    WHERE rc.organization_id=r.requested_organization_id) suggested_zone_id
 FROM customer_provider_requests r
 LEFT JOIN kampala_divisions division ON division.id=(SELECT division_id FROM customer_service_locations WHERE id=r.service_location_id)
 LEFT JOIN kampala_division_areas area ON area.id=(SELECT catalog_area_id FROM customer_service_locations WHERE id=r.service_location_id)
 JOIN customer_profiles cp ON cp.id=r.customer_id JOIN users u ON u.id=cp.user_id
 JOIN customer_service_locations l ON l.id=r.service_location_id
 JOIN organizations requested ON requested.id=r.requested_organization_id
 LEFT JOIN customer_service_relationships current ON current.id=r.current_relationship_id
 LEFT JOIN organizations current_org ON current_org.id=current.organization_id`;

// The companies that serve a place, best match first, with their lowest monthly plan for this kind of customer.
const collectorsSql=(source:string)=>`SELECT o.id,o.name,o.phone,o.email,rc.match,rc.rank,
  (SELECT MIN(sp.fee_ugx) FROM service_plans sp WHERE sp.organization_id=o.id AND sp.is_active AND sp.billing_frequency='monthly'
    AND (sp.customer_type IS NULL OR sp.customer_type=$CUSTOMER_TYPE))::bigint from_fee_ugx
 FROM ${source} JOIN organizations o ON o.id=rc.organization_id`;

export async function collectorsFor(input:{divisionId?:string;areaId?:string;latitude?:number;longitude?:number;customerType?:string}){
 const precise=Number.isFinite(input.latitude)&&Number.isFinite(input.longitude);
 const result=await dbPool.query(`${collectorsSql(`recommended_collectors($1::uuid,$2::uuid,
   CASE WHEN $3::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_Point($4::float8,$3::float8),4326)::geography END,$5) rc`).replace('$CUSTOMER_TYPE','$6')}
  ORDER BY rc.rank,o.name`,[input.divisionId??null,input.areaId??null,precise?input.latitude:null,precise?input.longitude:null,precise,input.customerType??null]);
 return result.rows;
}

export async function providerOptions(userId:string){
 const result=await dbPool.query(`${collectorsSql(`customer_profiles cp JOIN customer_service_locations l ON l.customer_id=cp.id AND l.is_primary
   CROSS JOIN LATERAL recommended_collectors(l.division_id,l.catalog_area_id,l.location,l.location_precise) rc`).replace('$CUSTOMER_TYPE','cp.customer_type')}
  LEFT JOIN customer_service_relationships current ON current.service_location_id=l.id AND current.status IN ('active','suspended')
  WHERE cp.user_id=$1::uuid AND o.id<>COALESCE(current.organization_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY rc.rank,o.name`,[userId]);
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
  const coverage=await client.query(`SELECT 1 FROM customer_service_locations l
   CROSS JOIN LATERAL recommended_collectors(l.division_id,l.catalog_area_id,l.location,l.location_precise) rc
   WHERE l.id=$2::uuid AND rc.organization_id=$1::uuid`,[organizationId,customer.location_id]);
  if(!coverage.rowCount)conflict('This company does not serve your area. Choose one of the companies listed for your area');
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
  // The zone the customer will be served from: the one the company chose, or the best match for the customer's place.
  const coverage=input.zoneId
   ?await client.query(`SELECT id FROM waste_zones WHERE id=$1::uuid AND organization_id=$2::uuid AND is_active`,[input.zoneId,organizationId])
   :await client.query(`SELECT rc.zone_id id FROM customer_service_locations l
     CROSS JOIN LATERAL recommended_collectors(l.division_id,l.catalog_area_id,l.location,l.location_precise) rc
     WHERE l.id=$2::uuid AND rc.organization_id=$1::uuid AND rc.zone_id IS NOT NULL`,[organizationId,request.service_location_id]);
  if(!coverage.rowCount)conflict(input.zoneId?'Choose one of your active service zones':'Choose the service zone this customer will be served from');
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
  // A customer who did not share their position is placed at the zone's centre until the company records the exact spot.
  await client.query(`UPDATE customer_service_locations l SET organization_id=$2,zone_id=$3,
    location=CASE WHEN l.location_precise OR z.center_point IS NULL THEN l.location ELSE z.center_point END,updated_at=CURRENT_TIMESTAMP
    FROM waste_zones z WHERE l.id=$1 AND z.id=$3`,[request.service_location_id,organizationId,coverage.rows[0].id]);
  await client.query("UPDATE customer_profiles SET service_status='active',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[request.customer_id]);
  const approved=await client.query(`UPDATE customer_provider_requests SET status='approved',review_note=$2,final_reviewed_by=$3,
   final_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[id,input.note??null,actorId]);
  await client.query('COMMIT');return approved.rows[0];
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
