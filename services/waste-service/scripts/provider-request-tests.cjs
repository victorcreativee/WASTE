module.exports=async({client,one,check,request,a,b,adminA,adminB,user})=>{
 const citizen=await user(null,'citizen');
 const boundary="ST_GeomFromText('POLYGON((32 0,33 0,33 1,32 1,32 0))',4326)";
 const zoneA=await one(`INSERT INTO waste_zones(organization_id,name,boundary) VALUES($1,'Link A',${boundary}) RETURNING id`,[a]);
 const zoneB=await one(`INSERT INTO waste_zones(organization_id,name,boundary) VALUES($1,'Link B',${boundary}) RETURNING id`,[b]);
 const location={customerType:'residential',label:'Home',address:'Provider request fixture',latitude:.4,longitude:32.4};
 check((await request(citizen,'/api/waste/customer-service/me','PUT',location)).status===200,'Citizen creates an unassigned location');
 let options=await request(citizen,'/api/waste/customer-service/provider-options');
 check(options.status===200&&options.body.data.some(o=>o.id===a)&&options.body.data.some(o=>o.id===b),'Citizen sees only geographically covered active providers');
 let created=await request(citizen,'/api/waste/customer-service/provider-requests','POST',{organizationId:b,note:'Please connect service'});
 check(created.status===201&&created.body.data.status==='pending_new_provider','Unassigned citizen request goes to target provider');
 const requestId=created.body.data.id;
 check((await request(adminA,`/api/waste/customers/provider-requests/${requestId}`,'PATCH',{action:'approve'})).status===404,'Unrelated company cannot review request');
 check((await request(adminB,`/api/waste/customers/provider-requests/${requestId}`,'PATCH',{action:'approve'})).status===200,'Target provider approves reviewed link');
 const linked=await one(`SELECT csr.organization_id,csl.organization_id location_org,csl.zone_id,z.organization_id zone_org
  FROM customer_service_relationships csr JOIN customer_service_locations csl ON csl.id=csr.service_location_id
  LEFT JOIN waste_zones z ON z.id=csl.zone_id
  JOIN customer_profiles cp ON cp.id=csr.customer_id WHERE cp.user_id=$1 AND csr.status='active'`,[citizen]);
 check(linked.organization_id===b&&linked.location_org===b&&linked.zone_org===b,'Approval creates relationship and updates compatibility location');
 check((await request(citizen,'/api/waste/customer-service/provider-requests','POST',{organizationId:a})).body.data.status==='pending_current_provider','Transfer first awaits current provider');
 let history=(await request(citizen,'/api/waste/customer-service/provider-requests')).body.data;
 const transfer=history.find(r=>r.status==='pending_current_provider');
 check((await request(adminA,`/api/waste/customers/provider-requests/${transfer.id}`,'PATCH',{action:'approve'})).status===404,'Target cannot bypass current-provider release');
 check((await request(adminB,`/api/waste/customers/provider-requests/${transfer.id}`,'PATCH',{action:'approve',note:'Released'})).body.data.status==='pending_new_provider','Current provider release advances request');
 check((await request(adminA,`/api/waste/customers/provider-requests/${transfer.id}`,'PATCH',{action:'approve'})).status===200,'Target provider completes transfer');
 const relationships=(await client.query(`SELECT organization_id,status,relationship_source FROM customer_service_relationships csr
  JOIN customer_profiles cp ON cp.id=csr.customer_id WHERE cp.user_id=$1 ORDER BY csr.created_at`,[citizen])).rows;
 check(relationships.some(r=>r.organization_id===b&&r.status==='ended')&&relationships.some(r=>r.organization_id===a&&r.status==='active'&&r.relationship_source==='reviewed_transfer'),'Transfer preserves ended history and creates reviewed target relationship');
 created=await request(citizen,'/api/waste/customer-service/provider-requests','POST',{organizationId:b});
 check((await request(citizen,`/api/waste/customer-service/provider-requests/${created.body.data.id}`,'DELETE')).status===200,'Citizen can cancel an open request');
 check((await request(adminB,`/api/waste/customers/provider-requests/${created.body.data.id}`,'PATCH',{action:'approve'})).status===404,'Cancelled request cannot be approved');

 const blocked=await user(null,'citizen');await request(blocked,'/api/waste/customer-service/me','PUT',location);
 const profile=await one('SELECT cp.id,l.id location_id FROM customer_profiles cp JOIN customer_service_locations l ON l.customer_id=cp.id WHERE cp.user_id=$1',[blocked]);
 await client.query('UPDATE customer_service_locations SET organization_id=$1,zone_id=$2 WHERE id=$3',[a,zoneA.id,profile.location_id]);
 const rel=await one(`INSERT INTO customer_service_relationships(customer_id,service_location_id,organization_id,status,relationship_source)
  VALUES($1,$2,$3,'active','reviewed_link') RETURNING id`,[profile.id,profile.location_id,a]);
 const plan=await one("INSERT INTO service_plans(organization_id,name,billing_frequency,fee_ugx) VALUES($1,'Transfer blocker','monthly',5000) RETURNING id",[a]);
 const sub=await one('INSERT INTO customer_subscriptions(customer_id,service_location_id,organization_id,plan_id) VALUES($1,$2,$3,$4) RETURNING id',[profile.id,profile.location_id,a,plan.id]);
 await client.query(`INSERT INTO customer_contracts(organization_id,customer_id,contract_number,service_name,starts_on,ends_on,billing_frequency,status,plan_id,subscription_id)
  VALUES($1,$2,$3,'Blocked',CURRENT_DATE,CURRENT_DATE+30,'monthly','active',$4,$5)`,[a,profile.id,'block-'+profile.id,plan.id,sub.id]);
 created=await request(blocked,'/api/waste/customer-service/provider-requests','POST',{organizationId:b});
 let review=await request(adminA,`/api/waste/customers/provider-requests/${created.body.data.id}`,'PATCH',{action:'approve'});
 check(review.status===409&&review.body.message.includes('Release blocked'),'Active agreement blocks provider release');
 await client.query("UPDATE customer_contracts SET status='cancelled' WHERE customer_id=$1",[profile.id]);
 await client.query("UPDATE customer_subscriptions SET status='cancelled' WHERE customer_id=$1",[profile.id]);
 check((await request(adminA,`/api/waste/customers/provider-requests/${created.body.data.id}`,'PATCH',{action:'approve'})).status===200,'Release continues after agreement closure');
 await client.query('UPDATE waste_zones SET is_active=false WHERE organization_id=$1',[b]);
 review=await request(adminB,`/api/waste/customers/provider-requests/${created.body.data.id}`,'PATCH',{action:'approve'});
 check(review.status===409&&review.body.message.includes('coverage'),'Target approval rechecks coverage');
 const stillCurrent=await one("SELECT organization_id FROM customer_service_relationships WHERE id=$1 AND status='active'",[rel.id]);
 check(stillCurrent.organization_id===a,'Failed final approval retains current provider');
 console.log('PASS: reviewed provider linking and transfer workflow.');
};
