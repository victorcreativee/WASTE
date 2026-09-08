// Runs inside test-stabilization's rollback-only transaction.
module.exports = async ({client,one,check,request,a,b,adminA,adminB,user}) => {
  const repo = require('../src/repositories/customer-service.repository');
  const {assignZoneServiceArea} = require('../src/repositories/waste.repository');
  const actor = await user(null,'citizen');
  const input = {customerType:'residential',label:'Home',address:'Rollback test address',longitude:32.5,latitude:0.3};
  const zone = await one(`INSERT INTO waste_zones(organization_id,name,boundary)
    VALUES($1,'Ownership fixture',ST_GeomFromText('POLYGON((32 0,33 0,33 1,32 1,32 0))',4326)) RETURNING id`,[a]);
  const {createOrganizationCustomerRecord}=require('../../auth-service/src/repositories/organization-user.repository');
  const {password_hash:passwordHash}=await one('SELECT password_hash FROM users WHERE id=$1',[actor]);
  for(const longitude of [32.5,34]) {
    const created=await createOrganizationCustomerRecord(client,{...input,longitude,organizationId:a,
      fullName:'Rollback customer',email:`${require('node:crypto').randomUUID()}@rollback.invalid`,passwordHash,locationLabel:'Home'});
    check(created.location.organization_id===a && created.location.zone_id===(longitude===32.5?zone.id:null),
      'Company onboarding retains explicit owner and only selects covered zones');
  }
  let saved = await repo.upsertCustomerService(actor,input);
  check(saved.location.organization_id===null && saved.location.zone_id===null,'Self-service address must not infer a provider');
  check(saved.providerAssignmentRequired===true,'Unassigned customer receives onboarding flag');
  // Explicit fixture relationship, not an application onboarding shortcut.
  await client.query('UPDATE customer_service_locations SET organization_id=$1 WHERE id=$2',[a,saved.location.id]);
  await client.query(`INSERT INTO customer_service_relationships(customer_id,service_location_id,organization_id,status,relationship_source)
    VALUES($1,$2,$3,'active','reviewed_link')`,[saved.customer.id,saved.location.id,a]);
  saved = await repo.upsertCustomerService(actor,input);
  check(saved.location.organization_id===a && saved.location.zone_id===zone.id,'Coverage matches retained provider polygon');
  const customerId=saved.customer.id;
  const read = async () => (await repo.findCustomers(a)).find(row=>row.id===customerId);
  check(!(await read()).planning_ready,'Missing agreement is not planning ready');
  await client.query("UPDATE customer_profiles SET service_status='active' WHERE id=$1",[customerId]);
  const plan=await one(`INSERT INTO service_plans(organization_id,name,billing_frequency,fee_ugx)
    VALUES($1,'Rollback package','monthly',12000) RETURNING id`,[a]);
  const sub=await one(`INSERT INTO customer_subscriptions(customer_id,service_location_id,organization_id,plan_id,starts_on)
    VALUES($1,$2,$3,$4,CURRENT_DATE) RETURNING id`,[customerId,saved.location.id,a,plan.id]);
  const contract=await one(`INSERT INTO customer_contracts(organization_id,customer_id,contract_number,service_name,
    starts_on,ends_on,billing_frequency,status,plan_id,subscription_id)
    VALUES($1,$2,$3,'Rollback service',CURRENT_DATE,CURRENT_DATE+30,'monthly','active',$4,$5) RETURNING id`,
    [a,customerId,'ownership-'+customerId,plan.id,sub.id]);
  check((await read()).planning_ready,'Current matching agreement and covered active customer pass checks');
  await client.query("UPDATE customer_profiles SET service_status='suspended' WHERE id=$1",[customerId]);
  check(!(await read()).planning_ready,'Suspended customer service blocks readiness');
  await client.query("UPDATE customer_profiles SET service_status='active' WHERE id=$1",[customerId]);
  for(const status of ['suspended','draft','expired']) {
    await client.query('UPDATE customer_contracts SET status=$1 WHERE id=$2',[status,contract.id]);
    check(!(await read()).planning_ready,`${status} contract blocks readiness`);
  }
  await client.query("UPDATE customer_contracts SET status='active',starts_on=CURRENT_DATE+1 WHERE id=$1",[contract.id]);
  check(!(await read()).planning_ready,'Future contract blocks readiness');
  await client.query('UPDATE customer_contracts SET starts_on=CURRENT_DATE WHERE id=$1',[contract.id]);
  await client.query("UPDATE customer_subscriptions SET status='suspended' WHERE id=$1",[sub.id]);
  check(!(await read()).planning_ready,'Suspended subscription blocks readiness');
  await client.query("UPDATE customer_subscriptions SET status='active' WHERE id=$1",[sub.id]);
  await client.query('UPDATE service_plans SET is_active=false WHERE id=$1',[plan.id]);
  check(!(await read()).planning_ready,'Inactive package blocks readiness');
  await client.query('UPDATE service_plans SET is_active=true WHERE id=$1',[plan.id]);
  const moved=await request(actor,'/api/waste/customer-service/me','PUT',{...input,longitude:34});
  check(moved.status===200 && moved.body.data.location.organization_id===a,'Address move retains provider over HTTP');
  check(moved.body.data.location.zone_id===null && !(await read()).planning_ready,'Outside polygon clears coverage; no nearest-zone fallback');
  check((await request(adminA,'/api/waste/customers')).body.data.some(row=>row.id===customerId),'Original company retains customer');
  check(!(await request(adminB,'/api/waste/customers')).body.data.some(row=>row.id===customerId),'Other company cannot see customer');
  await repo.upsertCustomerService(actor,input);
  const reassigned=await assignZoneServiceArea(zone.id,{organizationId:b});
  check(reassigned.rematched_customers===0,'Regulatory reassignment transfers no customers');
  const location=await one('SELECT organization_id FROM customer_service_locations WHERE id=$1',[saved.location.id]);
  check(location.organization_id===a && !(await read()).planning_ready,'Reassigned coverage retains original private ownership and requires review');
  const relationship=await one("SELECT organization_id,status FROM customer_service_relationships WHERE service_location_id=$1 AND status IN ('active','suspended')",[saved.location.id]);
  check(relationship.organization_id===a,'Explicit relationship remains with original provider');
  const overview=await repo.findCustomerServiceOverview(actor);
  check(overview.zone_id===null && overview.schedules.length===0 && overview.collection_history.length===0 && overview.upcoming_collection===null,'Foreign zone is excluded from citizen activity');
  check((await repo.findCustomers(null)).length===0,'Missing organization scope never returns customer directory');
  const agreement=await one(`SELECT c.organization_id,c.subscription_id,s.organization_id subscription_org
    FROM customer_contracts c JOIN customer_subscriptions s ON s.id=c.subscription_id WHERE c.id=$1`,[contract.id]);
  check(agreement.organization_id===a && agreement.subscription_org===a && agreement.subscription_id===sub.id,'Contract and subscription remain unchanged after address and regulatory changes');
  check((await request(adminA,`/api/waste/customers/${customerId}/status`,'PATCH',{status:'suspended'})).status===200,'Provider can suspend its explicit relationship');
  check((await one('SELECT status FROM customer_service_relationships WHERE service_location_id=$1',[saved.location.id])).status==='suspended','Relationship status follows service suspension');
  check((await request(adminA,`/api/waste/customers/${customerId}/status`,'PATCH',{status:'active'})).status===200,'Provider can reactivate its explicit relationship');
  check((await request(adminB,`/api/waste/customers/${customerId}/status`,'PATCH',{status:'suspended'})).status===404,'Other provider cannot mutate relationship service status');
};
