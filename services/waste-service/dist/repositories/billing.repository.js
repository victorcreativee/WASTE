"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServicePlan = createServicePlan;
exports.findServicePlans = findServicePlans;
exports.updateServicePlan = updateServicePlan;
exports.updateServicePlanStatus = updateServicePlanStatus;
exports.subscribeCustomer = subscribeCustomer;
exports.findBillingOverview = findBillingOverview;
exports.updateSubscriptionStatus = updateSubscriptionStatus;
exports.generateDueSubscriptionInvoices = generateDueSubscriptionInvoices;
exports.createPendingPayment = createPendingPayment;
exports.confirmPayment = confirmPayment;
exports.recordOrganizationPayment = recordOrganizationPayment;
const database_1 = require("../config/database");
async function createServicePlan(organizationId, input) {
    const result = await database_1.dbPool.query(`INSERT INTO service_plans (organization_id,name,description,customer_type,billing_frequency,fee_ugx,collections_per_period,response_hours)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [organizationId, input.name, input.description ?? null, input.customerType ?? null, input.billingFrequency, input.feeUgx, input.collectionsPerPeriod, input.responseHours]);
    return result.rows[0];
}
async function findServicePlans(organizationId, userId) {
    const result = await database_1.dbPool.query(`SELECT sp.*, o.name AS organization_name,
       (SELECT COUNT(*)::int FROM customer_contracts cc WHERE cc.plan_id=sp.id) AS contract_count,
       (SELECT COUNT(*)::int FROM customer_subscriptions cs WHERE cs.plan_id=sp.id AND cs.status IN ('active','pending','suspended')) AS subscription_count
     FROM service_plans sp JOIN organizations o ON o.id=sp.organization_id
     WHERE ($1::uuid IS NULL OR sp.organization_id=$1::uuid)
       AND ($1::uuid IS NOT NULL OR sp.is_active=true)
       AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM customer_profiles cp
         JOIN customer_service_locations csl ON csl.customer_id=cp.id AND csl.is_primary=true
         WHERE cp.user_id=$2::uuid AND csl.organization_id=sp.organization_id
           AND (sp.customer_type IS NULL OR sp.customer_type=cp.customer_type)))
     ORDER BY sp.fee_ugx,sp.name`, [organizationId, userId]);
    return result.rows;
}
async function updateServicePlan(organizationId, planId, input) {
    const result = await database_1.dbPool.query(`UPDATE service_plans sp SET name=$3,description=$4,customer_type=$5,billing_frequency=$6,
       fee_ugx=$7,collections_per_period=$8,response_hours=$9,updated_at=CURRENT_TIMESTAMP
     WHERE sp.id=$1::uuid AND sp.organization_id=$2::uuid
       AND NOT EXISTS(SELECT 1 FROM customer_contracts cc WHERE cc.plan_id=sp.id)
       AND NOT EXISTS(SELECT 1 FROM customer_subscriptions cs WHERE cs.plan_id=sp.id)
     RETURNING *`, [planId, organizationId, input.name, input.description ?? null, input.customerType ?? null, input.billingFrequency, input.feeUgx, input.collectionsPerPeriod, input.responseHours]);
    return result.rows[0] ?? null;
}
async function updateServicePlanStatus(organizationId, planId, isActive) {
    const result = await database_1.dbPool.query(`UPDATE service_plans sp SET is_active=$3,updated_at=CURRENT_TIMESTAMP
     WHERE sp.id=$1::uuid AND sp.organization_id=$2::uuid
       AND ($3=true OR NOT EXISTS(
         SELECT 1 FROM customer_subscriptions cs WHERE cs.plan_id=sp.id AND cs.status IN ('active','pending','suspended')
       )) RETURNING *`, [planId, organizationId, isActive]);
    return result.rows[0] ?? null;
}
async function subscribeCustomer(userId, planId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const match = await client.query(`SELECT cp.id AS customer_id,csl.id AS location_id,csl.organization_id,sp.fee_ugx,sp.billing_frequency
       FROM customer_profiles cp JOIN customer_service_locations csl ON csl.customer_id=cp.id AND csl.is_primary=true
       JOIN service_plans sp ON sp.id=$2::uuid AND sp.organization_id=csl.organization_id AND sp.is_active=true
       WHERE cp.user_id=$1::uuid AND (sp.customer_type IS NULL OR sp.customer_type=cp.customer_type)`, [userId, planId]);
        const row = match.rows[0];
        if (!row) {
            await client.query("ROLLBACK");
            return null;
        }
        const sub = await client.query(`INSERT INTO customer_subscriptions(customer_id,service_location_id,organization_id,plan_id,next_billing_date)
       VALUES($1,$2,$3,$4,CASE $5 WHEN 'monthly' THEN CURRENT_DATE+INTERVAL '1 month' WHEN 'quarterly' THEN CURRENT_DATE+INTERVAL '3 months' WHEN 'annual' THEN CURRENT_DATE+INTERVAL '1 year' ELSE NULL END)
       RETURNING *`, [row.customer_id, row.location_id, row.organization_id, planId, row.billing_frequency]);
        const invoiceNumber = `INV-${Date.now()}-${sub.rows[0].id.slice(0, 6).toUpperCase()}`;
        await client.query(`INSERT INTO customer_invoices(invoice_number,subscription_id,customer_id,organization_id,amount_ugx,balance_ugx,due_on)
       VALUES($1,$2,$3,$4,$5,$5,CURRENT_DATE+7)`, [invoiceNumber, sub.rows[0].id, row.customer_id, row.organization_id, row.fee_ugx]);
        await client.query("COMMIT");
        return sub.rows[0];
    }
    catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") {
            const conflict = new Error("This service location already has an active subscription");
            conflict.statusCode = 409;
            throw conflict;
        }
        throw error;
    }
    finally {
        client.release();
    }
}
async function findBillingOverview(organizationId, userId) {
    const params = [organizationId, userId];
    const subscriptions = await database_1.dbPool.query(`SELECT cs.*,sp.name AS plan_name,sp.fee_ugx,sp.billing_frequency,u.full_name AS customer_name,o.name AS organization_name
     FROM customer_subscriptions cs JOIN service_plans sp ON sp.id=cs.plan_id JOIN customer_profiles cp ON cp.id=cs.customer_id
     JOIN users u ON u.id=cp.user_id JOIN organizations o ON o.id=cs.organization_id
     WHERE ($1::uuid IS NULL OR cs.organization_id=$1::uuid) AND ($2::uuid IS NULL OR cp.user_id=$2::uuid)
     ORDER BY cs.created_at DESC`, params);
    const invoices = await database_1.dbPool.query(`SELECT ci.*,CASE WHEN ci.status IN ('issued','partially_paid') AND ci.due_on<CURRENT_DATE THEN 'overdue' ELSE ci.status END AS status,
       u.full_name AS customer_name,sp.name AS plan_name FROM customer_invoices ci
     JOIN customer_profiles cp ON cp.id=ci.customer_id JOIN users u ON u.id=cp.user_id
     JOIN customer_subscriptions cs ON cs.id=ci.subscription_id JOIN service_plans sp ON sp.id=cs.plan_id
     WHERE ($1::uuid IS NULL OR ci.organization_id=$1::uuid) AND ($2::uuid IS NULL OR cp.user_id=$2::uuid)
     ORDER BY ci.created_at DESC`, params);
    const payments = await database_1.dbPool.query(`SELECT p.*,ci.invoice_number,u.full_name AS customer_name FROM customer_payments p
     JOIN customer_invoices ci ON ci.id=p.invoice_id JOIN customer_profiles cp ON cp.id=p.customer_id JOIN users u ON u.id=cp.user_id
     WHERE ($1::uuid IS NULL OR p.organization_id=$1::uuid) AND ($2::uuid IS NULL OR cp.user_id=$2::uuid)
     ORDER BY p.created_at DESC`, params);
    return { subscriptions: subscriptions.rows, invoices: invoices.rows, payments: payments.rows };
}
async function updateSubscriptionStatus(organizationId, subscriptionId, status) {
    const result = await database_1.dbPool.query(`UPDATE customer_subscriptions SET status=$3::varchar,
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
     RETURNING *`, [subscriptionId, organizationId, status]);
    return result.rows[0] ?? null;
}
async function generateDueSubscriptionInvoices(organizationId) {
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        const due = await client.query(`SELECT cs.id subscription_id,cs.customer_id,cs.organization_id,cs.next_billing_date,
         sp.fee_ugx,sp.billing_frequency
       FROM customer_subscriptions cs JOIN service_plans sp ON sp.id=cs.plan_id
       WHERE cs.organization_id=$1::uuid AND cs.status='active'
         AND cs.next_billing_date IS NOT NULL AND cs.next_billing_date<=CURRENT_DATE
       ORDER BY cs.next_billing_date,cs.id FOR UPDATE OF cs SKIP LOCKED`, [organizationId]);
        const invoices = [];
        for (const [index, row] of due.rows.entries()) {
            const invoiceNumber = `INV-${Date.now()}-${index}-${String(row.subscription_id).slice(0, 6).toUpperCase()}`;
            const invoice = await client.query(`INSERT INTO customer_invoices(invoice_number,subscription_id,customer_id,organization_id,amount_ugx,balance_ugx,issued_on,due_on)
         VALUES($1,$2,$3,$4,$5,$5,CURRENT_DATE,CURRENT_DATE+7) RETURNING *`, [invoiceNumber, row.subscription_id, row.customer_id, row.organization_id, row.fee_ugx]);
            invoices.push(invoice.rows[0]);
            await client.query(`UPDATE customer_subscriptions SET next_billing_date=CASE $2::varchar
           WHEN 'monthly' THEN GREATEST(next_billing_date,CURRENT_DATE)+INTERVAL '1 month'
           WHEN 'quarterly' THEN GREATEST(next_billing_date,CURRENT_DATE)+INTERVAL '3 months'
           WHEN 'annual' THEN GREATEST(next_billing_date,CURRENT_DATE)+INTERVAL '1 year'
           ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [row.subscription_id, row.billing_frequency]);
        }
        await client.query("COMMIT");
        return invoices;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function createPendingPayment(userId, input, providerReference) {
    const result = await database_1.dbPool.query(`INSERT INTO customer_payments(invoice_id,customer_id,organization_id,amount_ugx,provider,provider_reference,payer_phone)
     SELECT ci.id,ci.customer_id,ci.organization_id,$3,$4,$5,$6 FROM customer_invoices ci
     JOIN customer_profiles cp ON cp.id=ci.customer_id WHERE ci.id=$2::uuid AND cp.user_id=$1::uuid
       AND ci.status IN ('issued','partially_paid','overdue') AND $3<=ci.balance_ugx RETURNING *`, [userId, input.invoiceId, input.amountUgx, input.provider, providerReference, input.payerPhone ?? null]);
    return result.rows[0] ?? null;
}
async function confirmPayment(paymentId, organizationId, reference) {
    // Confirmation is organization-private; a missing scope must never mean all tenants.
    if (!organizationId)
        return null;
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        // Serialize every receipt writer in this organization, including manual receipts.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`finance:${organizationId}`]);
        const found = await client.query(`SELECT * FROM customer_payments
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status='pending' FOR UPDATE`, [paymentId, organizationId]);
        const payment = found.rows[0];
        if (!payment) {
            await client.query("ROLLBACK");
            return null;
        }
        const providerReference = reference?.trim() || payment.provider_reference;
        if (providerReference) {
            const duplicate = await client.query(`SELECT 1 FROM customer_payments
         WHERE organization_id=$1::uuid AND provider_reference=$2 AND status='successful' LIMIT 1`, [organizationId, providerReference]);
            if (duplicate.rowCount) {
                await client.query("ROLLBACK");
                return null;
            }
        }
        // This conditional UPDATE locks and rechecks the balance after concurrent writers.
        // Reject stale/over-sized payments; never silently clamp a negative balance to zero.
        const invoice = await client.query(`UPDATE customer_invoices SET balance_ugx=balance_ugx-$3,
       status=CASE WHEN balance_ugx-$3=0 THEN 'paid' ELSE 'partially_paid' END,
       paid_at=CASE WHEN balance_ugx-$3=0 THEN CURRENT_TIMESTAMP ELSE paid_at END
       WHERE id=$1::uuid AND organization_id=$2::uuid AND customer_id=$4::uuid
         AND status IN ('issued','partially_paid','overdue')
         AND $3>0 AND balance_ugx>=$3 RETURNING *`, [payment.invoice_id, organizationId, payment.amount_ugx, payment.customer_id]);
        if (!invoice.rows[0]) {
            await client.query("ROLLBACK");
            return null;
        }
        const updated = await client.query(`UPDATE customer_payments SET status='successful',provider_reference=$3,
         confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status='pending' RETURNING *`, [paymentId, organizationId, providerReference ?? null]);
        await client.query("COMMIT");
        return { payment: updated.rows[0], invoice: invoice.rows[0] };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function recordOrganizationPayment(organizationId, input) {
    if (!organizationId || !Number.isSafeInteger(input.amountUgx) || input.amountUgx <= 0)
        return null;
    const client = await database_1.dbPool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`finance:${organizationId}`]);
        const found = await client.query(`SELECT id,customer_id,organization_id,balance_ugx,status FROM customer_invoices
       WHERE id=$1::uuid AND organization_id=$2::uuid AND status IN ('issued','partially_paid','overdue')
       FOR UPDATE`, [input.invoiceId, organizationId]);
        const invoice = found.rows[0];
        if (!invoice || input.amountUgx > Number(invoice.balance_ugx)) {
            await client.query("ROLLBACK");
            return null;
        }
        const duplicate = await client.query(`SELECT 1 FROM customer_payments WHERE organization_id=$1::uuid AND provider_reference=$2 AND status='successful' LIMIT 1`, [organizationId, input.providerReference]);
        if (duplicate.rowCount) {
            await client.query("ROLLBACK");
            return null;
        }
        const payment = await client.query(`INSERT INTO customer_payments(invoice_id,customer_id,organization_id,amount_ugx,provider,provider_reference,status,confirmed_at)
       VALUES($1,$2,$3,$4,$5,$6,'successful',CURRENT_TIMESTAMP) RETURNING *`, [invoice.id, invoice.customer_id, organizationId, input.amountUgx, input.provider, input.providerReference]);
        const updated = await client.query(`UPDATE customer_invoices SET balance_ugx=balance_ugx-$2,
       status=CASE WHEN balance_ugx-$2=0 THEN 'paid' ELSE 'partially_paid' END,
       paid_at=CASE WHEN balance_ugx-$2=0 THEN CURRENT_TIMESTAMP ELSE paid_at END
       WHERE id=$1::uuid RETURNING *`, [invoice.id, input.amountUgx]);
        await client.query("COMMIT");
        return { payment: payment.rows[0], invoice: updated.rows[0] };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
