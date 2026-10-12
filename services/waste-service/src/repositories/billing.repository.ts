import { dbPool } from "../config/database";

type ServicePlanInput = {
  name: string; description?: string; customerType?: string;
  billingFrequency: string; feeUgx: number; collectionsPerPeriod: number; responseHours: number;
};
type PaymentInput = {
  invoiceId: string; amountUgx: number; provider: string; payerPhone?: string;
};
type OrganizationPaymentInput = {
  invoiceId: string; amountUgx: number; provider: string; providerReference: string;
};

export async function createServicePlan(organizationId: string, input: ServicePlanInput) {
  const result = await dbPool.query(
    `INSERT INTO service_plans (organization_id,name,description,customer_type,billing_frequency,fee_ugx,collections_per_period,response_hours)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [organizationId,input.name,input.description??null,input.customerType??null,input.billingFrequency,input.feeUgx,input.collectionsPerPeriod,input.responseHours]
  ); return result.rows[0];
}
export async function findServicePlans(organizationId: string | null, userId: string | null) {
  const result = await dbPool.query(
    `SELECT sp.*, o.name AS organization_name,
       (SELECT COUNT(*)::int FROM customer_contracts cc WHERE cc.plan_id=sp.id) AS contract_count,
       (SELECT COUNT(*)::int FROM customer_subscriptions cs WHERE cs.plan_id=sp.id AND cs.status IN ('active','pending','suspended')) AS subscription_count
     FROM service_plans sp JOIN organizations o ON o.id=sp.organization_id
     WHERE ($1::uuid IS NULL OR sp.organization_id=$1::uuid)
       AND ($1::uuid IS NOT NULL OR sp.is_active=true)
       AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM customer_profiles cp
         JOIN customer_service_locations csl ON csl.customer_id=cp.id AND csl.is_primary=true
         WHERE cp.user_id=$2::uuid AND csl.organization_id=sp.organization_id
           AND (sp.customer_type IS NULL OR sp.customer_type=cp.customer_type)))
     ORDER BY sp.fee_ugx,sp.name`, [organizationId,userId]
  ); return result.rows;
}
export async function updateServicePlan(organizationId:string,planId:string,input:ServicePlanInput){
  const result=await dbPool.query(
    `UPDATE service_plans sp SET name=$3,description=$4,customer_type=$5,billing_frequency=$6,
       fee_ugx=$7,collections_per_period=$8,response_hours=$9,updated_at=CURRENT_TIMESTAMP
     WHERE sp.id=$1::uuid AND sp.organization_id=$2::uuid
       AND NOT EXISTS(SELECT 1 FROM customer_contracts cc WHERE cc.plan_id=sp.id)
       AND NOT EXISTS(SELECT 1 FROM customer_subscriptions cs WHERE cs.plan_id=sp.id)
     RETURNING *`,[planId,organizationId,input.name,input.description??null,input.customerType??null,input.billingFrequency,input.feeUgx,input.collectionsPerPeriod,input.responseHours]);
  return result.rows[0]??null;
}
export async function updateServicePlanStatus(organizationId:string,planId:string,isActive:boolean){
  const result=await dbPool.query(
    `UPDATE service_plans sp SET is_active=$3,updated_at=CURRENT_TIMESTAMP
     WHERE sp.id=$1::uuid AND sp.organization_id=$2::uuid
       AND ($3=true OR NOT EXISTS(
         SELECT 1 FROM customer_subscriptions cs WHERE cs.plan_id=sp.id AND cs.status IN ('active','pending','suspended')
       )) RETURNING *`,[planId,organizationId,isActive]);
  return result.rows[0]??null;
}
export async function subscribeCustomer(userId: string, planId: string) {
  const client=await dbPool.connect(); try { await client.query("BEGIN");
    const match=await client.query(
      `SELECT cp.id AS customer_id,csl.id AS location_id,csl.organization_id,sp.fee_ugx,sp.billing_frequency
       FROM customer_profiles cp JOIN customer_service_locations csl ON csl.customer_id=cp.id AND csl.is_primary=true
       JOIN service_plans sp ON sp.id=$2::uuid AND sp.organization_id=csl.organization_id AND sp.is_active=true
       WHERE cp.user_id=$1::uuid AND (sp.customer_type IS NULL OR sp.customer_type=cp.customer_type)`,[userId,planId]);
    const row=match.rows[0]; if(!row){await client.query("ROLLBACK");return null;}
    const sub=await client.query(
      `INSERT INTO customer_subscriptions(customer_id,service_location_id,organization_id,plan_id,next_billing_date)
       VALUES($1,$2,$3,$4,CASE $5 WHEN 'monthly' THEN CURRENT_DATE+INTERVAL '1 month' WHEN 'quarterly' THEN CURRENT_DATE+INTERVAL '3 months' WHEN 'annual' THEN CURRENT_DATE+INTERVAL '1 year' ELSE NULL END)
       RETURNING *`,[row.customer_id,row.location_id,row.organization_id,planId,row.billing_frequency]);
    await client.query(
      `INSERT INTO customer_invoices(invoice_number,subscription_id,customer_id,organization_id,amount_ugx,balance_ugx,due_on,billing_period_start,billing_period_end)
       VALUES('INV-'||to_char(CURRENT_DATE,'YYYY')||'-'||LPAD(nextval('customer_invoice_number_seq')::text,6,'0'),$1,$2,$3,$4,$4,CURRENT_DATE+7,CURRENT_DATE,CURRENT_DATE)`,[sub.rows[0].id,row.customer_id,row.organization_id,row.fee_ugx]);
    await client.query("COMMIT");return sub.rows[0];
  }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505"){const conflict=new Error("This service location already has an active subscription") as Error&{statusCode?:number};conflict.statusCode=409;throw conflict;}throw error;}finally{client.release();}
}
export async function findBillingOverview(organizationId:string|null,userId:string|null){
  const params=[organizationId,userId];
  const subscriptions=await dbPool.query(
    `SELECT cs.*,sp.name AS plan_name,sp.fee_ugx,sp.billing_frequency,u.full_name AS customer_name,o.name AS organization_name
     FROM customer_subscriptions cs JOIN service_plans sp ON sp.id=cs.plan_id JOIN customer_profiles cp ON cp.id=cs.customer_id
     JOIN users u ON u.id=cp.user_id JOIN organizations o ON o.id=cs.organization_id
     WHERE ($1::uuid IS NULL OR cs.organization_id=$1::uuid) AND ($2::uuid IS NULL OR cp.user_id=$2::uuid)
     ORDER BY cs.created_at DESC`,params);
  const invoices=await dbPool.query(
    `SELECT ci.*,CASE WHEN ci.status IN ('issued','partially_paid') AND ci.due_on<CURRENT_DATE THEN 'overdue' ELSE ci.status END AS status,
       u.full_name AS customer_name,cp.customer_number,sp.name AS plan_name FROM customer_invoices ci
     JOIN customer_profiles cp ON cp.id=ci.customer_id JOIN users u ON u.id=cp.user_id
     JOIN customer_subscriptions cs ON cs.id=ci.subscription_id JOIN service_plans sp ON sp.id=cs.plan_id
     WHERE ($1::uuid IS NULL OR ci.organization_id=$1::uuid) AND ($2::uuid IS NULL OR cp.user_id=$2::uuid)
     ORDER BY ci.created_at DESC`,params);
  const payments=await dbPool.query(
    `SELECT p.*,ci.invoice_number,u.full_name AS customer_name FROM customer_payments p
     JOIN customer_invoices ci ON ci.id=p.invoice_id JOIN customer_profiles cp ON cp.id=p.customer_id JOIN users u ON u.id=cp.user_id
     WHERE ($1::uuid IS NULL OR p.organization_id=$1::uuid) AND ($2::uuid IS NULL OR cp.user_id=$2::uuid)
     ORDER BY p.created_at DESC`,params);
  return {subscriptions:subscriptions.rows,invoices:invoices.rows,payments:payments.rows};
}
export async function findPaymentReceipt(paymentId:string,organizationId:string|null,userId:string|null){
  const result=await dbPool.query(`SELECT p.id,p.receipt_number,p.amount_ugx,p.provider,p.provider_reference,p.confirmed_at,
    ci.invoice_number,ci.amount_ugx invoice_amount_ugx,ci.balance_ugx invoice_balance_ugx,ci.billing_period_start,ci.billing_period_end,
    cp.customer_number,u.full_name customer_name,u.email customer_email,o.name organization_name,
    sp.name plan_name
    FROM customer_payments p JOIN customer_invoices ci ON ci.id=p.invoice_id
    JOIN customer_profiles cp ON cp.id=p.customer_id JOIN users u ON u.id=cp.user_id
    JOIN organizations o ON o.id=p.organization_id JOIN customer_subscriptions cs ON cs.id=ci.subscription_id
    JOIN service_plans sp ON sp.id=cs.plan_id
    WHERE p.id=$1::uuid AND p.status='successful' AND p.receipt_number IS NOT NULL
      AND (($2::uuid IS NOT NULL AND p.organization_id=$2::uuid) OR ($3::uuid IS NOT NULL AND cp.user_id=$3::uuid))`,[paymentId,organizationId,userId]);
  return result.rows[0]??null;
}
export async function updateSubscriptionStatus(organizationId:string,subscriptionId:string,status:string){
  const result=await dbPool.query(
    `UPDATE customer_subscriptions SET status=$3::varchar,
       next_billing_date=CASE
         WHEN $3::varchar='cancelled' THEN NULL
         WHEN $3::varchar='active' THEN (SELECT CASE sp.billing_frequency
           WHEN 'monthly' THEN CURRENT_DATE+INTERVAL '1 month'
           WHEN 'quarterly' THEN CURRENT_DATE+INTERVAL '3 months'
           WHEN 'annual' THEN CURRENT_DATE+INTERVAL '1 year'
           ELSE NULL END FROM service_plans sp WHERE sp.id=customer_subscriptions.plan_id)
         ELSE next_billing_date END,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=$1::uuid AND organization_id=$2::uuid AND (
       (status='active' AND $3::varchar IN ('suspended','cancelled')) OR
       (status='suspended' AND $3::varchar IN ('active','cancelled')) OR
       (status='pending' AND $3::varchar IN ('active','cancelled')))
     RETURNING *`,[subscriptionId,organizationId,status]);
  return result.rows[0]??null;
}
export async function generateDueSubscriptionInvoices(organizationId:string,actorId:string){
  const client=await dbPool.connect();try{await client.query("BEGIN");
    const due=await client.query(
      `SELECT cs.id subscription_id,cs.customer_id,cs.organization_id,cs.next_billing_date,
         sp.fee_ugx,sp.billing_frequency,cc.ends_on contract_ends_on
       FROM customer_subscriptions cs JOIN service_plans sp ON sp.id=cs.plan_id
       JOIN customer_contracts cc ON cc.subscription_id=cs.id AND cc.status IN ('active','expiring')
       WHERE cs.organization_id=$1::uuid AND cs.status='active'
         AND cs.next_billing_date IS NOT NULL AND cs.next_billing_date<=CURRENT_DATE
       ORDER BY cs.next_billing_date,cs.id FOR UPDATE OF cs SKIP LOCKED`,[organizationId]);
    const invoices=[];
    for(const row of due.rows){
      let periods=0;
      while(row.next_billing_date&&new Date(row.next_billing_date)<=new Date()&&periods<120){
        const invoice=await client.query(
          `INSERT INTO customer_invoices(invoice_number,subscription_id,customer_id,organization_id,amount_ugx,balance_ugx,issued_on,due_on,billing_period_start,billing_period_end)
           VALUES('INV-'||to_char(CURRENT_DATE,'YYYY')||'-'||LPAD(nextval('customer_invoice_number_seq')::text,6,'0'),$1,$2,$3,$4,$4,CURRENT_DATE,CURRENT_DATE+7,$5::date,LEAST($6::date,CASE $7::varchar WHEN 'monthly' THEN ($5::date+INTERVAL '1 month'-INTERVAL '1 day')::date WHEN 'quarterly' THEN ($5::date+INTERVAL '3 months'-INTERVAL '1 day')::date WHEN 'annual' THEN ($5::date+INTERVAL '1 year'-INTERVAL '1 day')::date ELSE $5::date END))
           ON CONFLICT DO NOTHING RETURNING *`,
          [row.subscription_id,row.customer_id,row.organization_id,row.fee_ugx,row.next_billing_date,row.contract_ends_on,row.billing_frequency]);
        if(invoice.rows[0]){
          invoices.push(invoice.rows[0]);
          await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value) VALUES($1::uuid,$2::uuid,'invoice_generated','customer_invoice',$3::uuid,$4::jsonb)`,[organizationId,actorId,invoice.rows[0].id,JSON.stringify({invoiceNumber:invoice.rows[0].invoice_number,amountUgx:Number(invoice.rows[0].amount_ugx),billingPeriodStart:invoice.rows[0].billing_period_start,billingPeriodEnd:invoice.rows[0].billing_period_end})]);
        }
        const advanced=await client.query(
          `UPDATE customer_subscriptions SET next_billing_date=CASE $2::varchar
             WHEN 'monthly' THEN CASE WHEN next_billing_date+INTERVAL '1 month'<=$3::date THEN next_billing_date+INTERVAL '1 month' END
             WHEN 'quarterly' THEN CASE WHEN next_billing_date+INTERVAL '3 months'<=$3::date THEN next_billing_date+INTERVAL '3 months' END
             WHEN 'annual' THEN CASE WHEN next_billing_date+INTERVAL '1 year'<=$3::date THEN next_billing_date+INTERVAL '1 year' END
             ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING next_billing_date`,
          [row.subscription_id,row.billing_frequency,row.contract_ends_on]);
        row.next_billing_date=advanced.rows[0]?.next_billing_date??null;
        periods+=1;
      }
    }
    await client.query("COMMIT");return invoices;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function createPendingPayment(userId:string,input:PaymentInput,providerReference:string|null){
  const result=await dbPool.query(
    `INSERT INTO customer_payments(invoice_id,customer_id,organization_id,amount_ugx,provider,provider_reference,payer_phone)
     SELECT ci.id,ci.customer_id,ci.organization_id,$3,$4,$5,$6 FROM customer_invoices ci
     JOIN customer_profiles cp ON cp.id=ci.customer_id WHERE ci.id=$2::uuid AND cp.user_id=$1::uuid
       AND ci.status IN ('issued','partially_paid','overdue') AND $3<=ci.balance_ugx RETURNING *`,
    [userId,input.invoiceId,input.amountUgx,input.provider,providerReference,input.payerPhone??null]);return result.rows[0]??null;
}
export async function confirmPayment(paymentId:string,organizationId:string|null,reference?:string,actorId?:string){
  // Confirmation is organization-private; a missing scope must never mean all tenants.
  if (!organizationId) return null;
  const client=await dbPool.connect();
  try {
    await client.query("BEGIN");
    // Serialize every receipt writer in this organization, including manual receipts.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`finance:${organizationId}`]);
    const found=await client.query(
      `SELECT * FROM customer_payments
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status='pending' FOR UPDATE`,
      [paymentId,organizationId]);
    const payment=found.rows[0];
    if(!payment){await client.query("ROLLBACK");return null;}
    const providerReference=reference?.trim() || payment.provider_reference;
    if(providerReference){
      const duplicate=await client.query(
        `SELECT 1 FROM customer_payments
         WHERE organization_id=$1::uuid AND provider_reference=$2 AND status='successful' LIMIT 1`,
        [organizationId,providerReference]);
      if(duplicate.rowCount){await client.query("ROLLBACK");return null;}
    }
    // This conditional UPDATE locks and rechecks the balance after concurrent writers.
    // Reject stale/over-sized payments; never silently clamp a negative balance to zero.
    const invoice=await client.query(
      `UPDATE customer_invoices SET balance_ugx=balance_ugx-$3,
       status=CASE WHEN balance_ugx-$3=0 THEN 'paid' ELSE 'partially_paid' END,
       paid_at=CASE WHEN balance_ugx-$3=0 THEN CURRENT_TIMESTAMP ELSE paid_at END
       WHERE id=$1::uuid AND organization_id=$2::uuid AND customer_id=$4::uuid
         AND status IN ('issued','partially_paid','overdue')
         AND $3>0 AND balance_ugx>=$3 RETURNING *`,
      [payment.invoice_id,organizationId,payment.amount_ugx,payment.customer_id]);
    if(!invoice.rows[0]){await client.query("ROLLBACK");return null;}
    const updated=await client.query(
      `UPDATE customer_payments SET status='successful',provider_reference=$3,
         receipt_number='RCT-'||to_char(CURRENT_DATE,'YYYY')||'-'||LPAD(nextval('customer_receipt_number_seq')::text,6,'0'),
         confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status='pending' RETURNING *`,
      [paymentId,organizationId,providerReference??null]);
    if(actorId)await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value) VALUES($1::uuid,$2::uuid,'customer_payment_confirmed','customer_payment',$3::uuid,$4::jsonb)`,[organizationId,actorId,paymentId,JSON.stringify({invoiceId:payment.invoice_id,amountUgx:Number(payment.amount_ugx),providerReference:providerReference??null})]);
    await client.query("COMMIT");
    return {payment:updated.rows[0],invoice:invoice.rows[0]};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function recordOrganizationPayment(organizationId:string,input:OrganizationPaymentInput,actorId:string){
  if (!organizationId || !Number.isSafeInteger(input.amountUgx) || input.amountUgx <= 0) return null;
  const client=await dbPool.connect();try{await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`finance:${organizationId}`]);
    const found=await client.query(
      `SELECT id,customer_id,organization_id,balance_ugx,status FROM customer_invoices
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status IN ('issued','partially_paid','overdue')
       FOR UPDATE`,[input.invoiceId,organizationId]);
    const invoice=found.rows[0];
    if(!invoice||input.amountUgx>Number(invoice.balance_ugx)){await client.query("ROLLBACK");return null;}
    const duplicate=await client.query(
      `SELECT 1 FROM customer_payments WHERE organization_id=$1::uuid AND provider_reference=$2 AND status='successful' LIMIT 1`,
      [organizationId,input.providerReference]);
    if(duplicate.rowCount){await client.query("ROLLBACK");return null;}
    const payment=await client.query(
      `INSERT INTO customer_payments(invoice_id,customer_id,organization_id,amount_ugx,provider,provider_reference,status,confirmed_at,receipt_number)
       VALUES($1,$2,$3,$4,$5,$6,'successful',CURRENT_TIMESTAMP,'RCT-'||to_char(CURRENT_DATE,'YYYY')||'-'||LPAD(nextval('customer_receipt_number_seq')::text,6,'0')) RETURNING *`,
      [invoice.id,invoice.customer_id,organizationId,input.amountUgx,input.provider,input.providerReference]);
    const updated=await client.query(
      `UPDATE customer_invoices SET balance_ugx=balance_ugx-$2,
       status=CASE WHEN balance_ugx-$2=0 THEN 'paid' ELSE 'partially_paid' END,
       paid_at=CASE WHEN balance_ugx-$2=0 THEN CURRENT_TIMESTAMP ELSE paid_at END
       WHERE id=$1::uuid RETURNING *`,[invoice.id,input.amountUgx]);
    await client.query(`INSERT INTO organization_audit_events(organization_id,actor_id,action,entity_type,entity_id,new_value) VALUES($1::uuid,$2::uuid,'customer_payment_recorded','customer_payment',$3::uuid,$4::jsonb)`,[organizationId,actorId,payment.rows[0].id,JSON.stringify({invoiceId:invoice.id,amountUgx:input.amountUgx,provider:input.provider,providerReference:input.providerReference})]);
    await client.query("COMMIT");return {payment:payment.rows[0],invoice:updated.rows[0]};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
