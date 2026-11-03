import { dbPool } from "../config/database";
import { decryptCredentials, encryptCredentials, hint } from "../billing/credentials";
import {
  Account, AirtelCredentials, Environment, MobileMoneyClient, MtnCredentials, Provider, ProviderError, SimulatedClient,
  clientFor, nextCheckDelaySeconds, simulatorEnabled,
} from "../billing/mobile-money";
import { confirmPayment, createPendingPayment } from "./billing.repository";

// Mobile money payments through each company's own MTN MoMo / Airtel Money account (migration 112).
// A household's request is stored first, then sent to the provider. The provider's status answer, checked on a
// schedule and whenever a callback arrives, is what confirms or fails it. Anything that does not add up (amount
// differs, bill no longer payable, no final answer) is set aside for the company to review instead of guessed at.

const PROVIDERS: Provider[] = ["mtn_momo", "airtel_money"];
const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

// ---------- Company accounts ----------

export async function listPaymentAccounts(organizationId: string) {
  const rows = (await dbPool.query(`SELECT provider,environment,credentials_hint,status,last_verified_at,last_error,updated_at
    FROM organization_payment_accounts WHERE organization_id=$1::uuid`, [organizationId])).rows;
  return {
    accounts: PROVIDERS.map(provider => rows.find(row => row.provider === provider) ?? { provider, status: "not_connected" }),
    simulator: simulatorEnabled(),
    callback_url: callbackBase() ? `${callbackBase()}/api/waste/public/payments/airtel` : null,
  };
}

export async function savePaymentAccount(organizationId: string, provider: Provider, input: { environment: Environment; credentials: MtnCredentials | AirtelCredentials }, userId: string) {
  const account: Account = { provider, environment: input.environment, credentials: input.credentials };
  // The hint comes from the non-secret identifier, so nothing secret is ever shown back.
  const identifier = provider === "mtn_momo" ? (input.credentials as MtnCredentials).apiUser : (input.credentials as AirtelCredentials).clientId;
  const verifiedError = await clientFor(account).testConnection().then(() => null, (error: unknown) => error instanceof ProviderError ? error.message : "Could not reach the provider");
  await dbPool.query(`INSERT INTO organization_payment_accounts(organization_id,provider,environment,credentials_encrypted,credentials_hint,status,last_verified_at,last_error,updated_by)
    VALUES($1,$2,$3,$4,$5,'active',CASE WHEN $6::text IS NULL THEN CURRENT_TIMESTAMP END,$6,$7)
    ON CONFLICT(organization_id,provider) DO UPDATE SET environment=EXCLUDED.environment,credentials_encrypted=EXCLUDED.credentials_encrypted,
      credentials_hint=EXCLUDED.credentials_hint,status='active',last_verified_at=EXCLUDED.last_verified_at,last_error=EXCLUDED.last_error,
      updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,
    [organizationId, provider, input.environment, encryptCredentials(input.credentials), hint(identifier), verifiedError, userId]);
  return { verified: !verifiedError, error: verifiedError };
}

export async function setPaymentAccountStatus(organizationId: string, provider: Provider, status: "active" | "disabled") {
  return (await dbPool.query(`UPDATE organization_payment_accounts SET status=$3,updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=$1::uuid AND provider=$2 RETURNING provider,status`, [organizationId, provider, status])).rows[0] ?? null;
}

export async function testPaymentAccount(organizationId: string, provider: Provider) {
  const account = await loadAccount(organizationId, provider, true);
  if (!account) throw httpError("Connect this provider first", 404);
  const error = await clientFor(account).testConnection().then(() => null, (e: unknown) => e instanceof ProviderError ? e.message : "Could not reach the provider");
  await dbPool.query(`UPDATE organization_payment_accounts SET last_verified_at=CASE WHEN $3::text IS NULL THEN CURRENT_TIMESTAMP ELSE last_verified_at END,last_error=$3
    WHERE organization_id=$1::uuid AND provider=$2`, [organizationId, provider, error]);
  return { verified: !error, error };
}

async function loadAccount(organizationId: string, provider: string, includeDisabled = false): Promise<Account | null> {
  const row = (await dbPool.query(`SELECT provider,environment,credentials_encrypted FROM organization_payment_accounts
    WHERE organization_id=$1::uuid AND provider=$2 AND ($3 OR status='active')`, [organizationId, provider, includeDisabled])).rows[0];
  return row ? { provider: row.provider, environment: row.environment, credentials: decryptCredentials(row.credentials_encrypted) } : null;
}

/** The client that takes payments for this company and provider, or null when payments are confirmed by hand. */
async function clientForCompany(organizationId: string, provider: string): Promise<{ client: MobileMoneyClient; environment: string } | null> {
  const account = await loadAccount(organizationId, provider);
  if (account) return { client: clientFor(account), environment: account.environment };
  return simulatorEnabled() ? { client: new SimulatedClient(), environment: "simulator" } : null;
}

const callbackBase = () => (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "") || null;

// ---------- Household payments ----------

/**
 * Starts a household's payment. With a connected account (or the simulator) the request goes to the payer's phone and
 * is confirmed automatically; otherwise it is recorded for the company to confirm by hand, as before.
 */
export async function startCustomerPayment(userId: string, input: { invoiceId: string; amountUgx: number; provider: string; payerPhone?: string }) {
  const invoice = (await dbPool.query(`SELECT ci.id,ci.invoice_number,ci.organization_id,o.name company_name FROM customer_invoices ci
    JOIN customer_profiles cp ON cp.id=ci.customer_id JOIN organizations o ON o.id=ci.organization_id
    WHERE ci.id=$1::uuid AND cp.user_id=$2::uuid`, [input.invoiceId, userId])).rows[0];
  if (!invoice) return null;
  const connected = input.provider === "manual" ? null : await clientForCompany(invoice.organization_id, input.provider);
  if (!connected) {
    const payment = await createPendingPayment(userId, input, null);
    return payment ? { payment, automatic: false, message: "Payment recorded. Your collection company will confirm it once the money arrives." } : null;
  }
  if (!input.payerPhone) throw httpError("Enter the mobile money number to charge", 400);
  const waiting = (await dbPool.query(`SELECT 1 FROM customer_payments WHERE invoice_id=$1::uuid AND status='pending' AND provider_request_id IS NOT NULL
    AND initiated_at>CURRENT_TIMESTAMP-interval '5 minutes' AND NOT needs_review`, [invoice.id])).rowCount;
  if (waiting) throw httpError("A payment request for this bill is already waiting on a phone. Approve it there, or try again in a few minutes.", 409);

  const requestId = connected.client.newRequestId();
  const payment = await createPendingPayment(userId, input, null);
  if (!payment) return null;
  await dbPool.query(`UPDATE customer_payments SET provider_request_id=$2,provider_environment=$3,initiated_at=CURRENT_TIMESTAMP,
    next_check_at=CURRENT_TIMESTAMP+interval '10 seconds',provider_status='SENT',updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`,
    [payment.id, requestId, connected.environment]);
  try {
    await connected.client.collect({
      requestId, amountUgx: Number(payment.amount_ugx), phone: input.payerPhone, reference: invoice.invoice_number,
      note: `${invoice.company_name} bill ${invoice.invoice_number}`.slice(0, 64),
      callbackUrl: input.provider === "mtn_momo" && callbackBase() ? `${callbackBase()}/api/waste/public/payments/mtn/${payment.id}` : undefined,
    });
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : "The payment request could not be sent";
    await dbPool.query(`UPDATE customer_payments SET status='failed',failure_reason=$2,provider_status='NOT_SENT',next_check_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [payment.id, message]);
    throw httpError(message, 502);
  }
  return { payment: { ...payment, provider_request_id: requestId }, automatic: true, message: "Check your phone and enter your PIN to approve the payment." };
}

export async function findHouseholdPayment(paymentId: string, userId: string) {
  return (await dbPool.query(`SELECT p.id,p.invoice_id,p.amount_ugx,p.provider,p.status,p.receipt_number,p.failure_reason,p.provider_status,p.created_at,
    p.provider_request_id IS NOT NULL automatic
    FROM customer_payments p JOIN customer_profiles cp ON cp.id=p.customer_id WHERE p.id=$1::uuid AND cp.user_id=$2::uuid`, [paymentId, userId])).rows[0] ?? null;
}

// ---------- Checking with the provider ----------

type Outcome = "confirmed" | "failed" | "pending" | "review" | "skipped";

/** Asks the provider about one payment and applies the answer. Safe to call repeatedly and from several places. */
export async function checkPayment(paymentId: string): Promise<Outcome> {
  const payment = (await dbPool.query(`SELECT id,organization_id,provider,provider_request_id,amount_ugx,check_attempts,provider_environment
    FROM customer_payments WHERE id=$1::uuid AND status='pending' AND provider_request_id IS NOT NULL AND NOT needs_review`, [paymentId])).rows[0];
  if (!payment) return "skipped";
  const connected = payment.provider_environment === "simulator"
    ? (simulatorEnabled() ? { client: new SimulatedClient() } : null)
    : await loadAccount(payment.organization_id, payment.provider, true).then(account => account ? { client: clientFor(account) } : null);
  if (!connected) return review(paymentId, "The company's mobile money account was removed before this payment was confirmed");

  let result;
  try {
    result = await connected.client.status(payment.provider_request_id);
  } catch (error) {
    return reschedule(payment, error instanceof ProviderError ? error.message : "Status check failed");
  }
  await dbPool.query(`UPDATE customer_payments SET provider_status=$2,provider_message=$3,provider_amount_ugx=COALESCE($4,provider_amount_ugx),last_checked_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`,
    [paymentId, result.providerStatus, result.message ?? null, result.amountUgx ?? null]);

  if (result.state === "failed") {
    await dbPool.query(`UPDATE customer_payments SET status='failed',failure_reason=$2,next_check_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND status='pending'`,
      [paymentId, result.message || "The payer did not approve the payment"]);
    return "failed";
  }
  if (result.state === "pending") return reschedule(payment, null);
  if (result.amountUgx !== undefined && result.amountUgx !== Number(payment.amount_ugx)) {
    return review(paymentId, `The provider reports ${result.amountUgx} UGX received for a ${payment.amount_ugx} UGX request`);
  }
  const reference = result.externalId || payment.provider_request_id;
  const confirmed = await confirmPayment(paymentId, payment.organization_id, reference);
  if (!confirmed) return review(paymentId, "The money was received but the bill could not take it (already paid, cancelled, or this transaction was already used). Refund or apply it by hand.");
  await dbPool.query("UPDATE customer_payments SET next_check_at=NULL WHERE id=$1::uuid", [paymentId]);
  return "confirmed";
}

async function reschedule(payment: { id: string; check_attempts: number }, error: string | null): Promise<Outcome> {
  const delay = nextCheckDelaySeconds(payment.check_attempts + 1);
  if (delay === null) return review(payment.id, `No final answer from the provider after ${payment.check_attempts + 1} checks${error ? ` (last: ${error})` : ""}`);
  await dbPool.query(`UPDATE customer_payments SET check_attempts=check_attempts+1,next_check_at=CURRENT_TIMESTAMP+make_interval(secs=>$2),
    provider_message=COALESCE($3,provider_message) WHERE id=$1::uuid`, [payment.id, delay, error]);
  return "pending";
}

async function review(paymentId: string, reason: string): Promise<Outcome> {
  await dbPool.query("UPDATE customer_payments SET needs_review=true,review_reason=$2,next_check_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid", [paymentId, reason]);
  return "review";
}

/** Checks payments that are due, claiming each so that several service instances never check the same one at once. */
export async function runDuePaymentChecks(limit = 20) {
  const due = (await dbPool.query(`UPDATE customer_payments SET next_check_at=CURRENT_TIMESTAMP+interval '2 minutes'
    WHERE id IN (SELECT id FROM customer_payments WHERE status='pending' AND provider_request_id IS NOT NULL AND NOT needs_review
      AND next_check_at<=CURRENT_TIMESTAMP ORDER BY next_check_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING id`, [limit])).rows;
  const outcome: Record<Outcome, number> = { confirmed: 0, failed: 0, pending: 0, review: 0, skipped: 0 };
  for (const { id } of due) outcome[await checkPayment(id)]++;
  return outcome;
}

/** Stores a provider callback and checks the payment it names. The callback body itself is never trusted. */
export async function recordCallback(provider: Provider, ref: { paymentId?: string; requestId?: string }, body: unknown, remoteIp: string | undefined) {
  const payment = (await dbPool.query(`SELECT id FROM customer_payments WHERE provider=$1 AND (($2::uuid IS NOT NULL AND id=$2::uuid) OR ($3::text IS NOT NULL AND provider_request_id=$3))`,
    [provider, ref.paymentId ?? null, ref.requestId ?? null])).rows[0];
  await dbPool.query("INSERT INTO payment_provider_callbacks(provider,payment_id,request_id,body,remote_ip) VALUES($1,$2,$3,$4,$5)",
    [provider, payment?.id ?? null, ref.requestId ?? null, JSON.stringify(body ?? null).slice(0, 20_000), remoteIp ?? null]);
  if (payment) checkPayment(payment.id).catch(error => console.error("Payment check after callback failed", error));
  return Boolean(payment);
}

// ---------- Company: checks, review and reconciliation ----------

export async function checkCompanyPayment(paymentId: string, organizationId: string) {
  const found = (await dbPool.query("SELECT id FROM customer_payments WHERE id=$1::uuid AND organization_id=$2::uuid", [paymentId, organizationId])).rows[0];
  if (!found) return null;
  return { outcome: await checkPayment(paymentId) };
}

/** Closes a payment set aside for review, with what the company did about it. */
export async function resolvePaymentReview(paymentId: string, organizationId: string, userId: string, input: { resolution: "refunded" | "applied_by_hand" | "not_received"; note: string }) {
  const labels = { refunded: "Refunded to the payer", applied_by_hand: "Applied by hand", not_received: "Money not received" };
  return (await dbPool.query(`UPDATE customer_payments SET needs_review=false,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=$3,
      review_reason=concat_ws(E'\n',review_reason,$4::text),
      status=CASE WHEN $5 AND status='pending' THEN 'failed' ELSE status END,
      failure_reason=CASE WHEN $5 AND status='pending' THEN $4::text ELSE failure_reason END,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1::uuid AND organization_id=$2::uuid AND needs_review RETURNING id,status`,
    [paymentId, organizationId, userId, `${labels[input.resolution]}: ${input.note}`, input.resolution !== "applied_by_hand"])).rows[0] ?? null;
}

// created_at is a plain TIMESTAMP written in the database time zone, which is UTC in every deployment.
const KAMPALA_DAY = "(p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Kampala')::date";

export async function mobileMoneyReconciliation(organizationId: string, from: string, to: string) {
  const range = `p.organization_id=$1::uuid AND p.provider IN ('mtn_momo','airtel_money') AND ${KAMPALA_DAY} BETWEEN $2::date AND $3::date`;
  const [days, totals, open] = await Promise.all([
    dbPool.query(`SELECT ${KAMPALA_DAY}::text AS day,p.provider,
       count(*)::int requests,
       count(*) FILTER (WHERE p.status='successful')::int confirmed,
       COALESCE(sum(p.amount_ugx) FILTER (WHERE p.status='successful'),0)::bigint confirmed_ugx,
       count(*) FILTER (WHERE p.status='failed')::int failed,
       count(*) FILTER (WHERE p.status='pending' AND NOT p.needs_review)::int waiting,
       count(*) FILTER (WHERE p.needs_review OR p.reviewed_at IS NOT NULL)::int exceptions
     FROM customer_payments p WHERE ${range} AND p.provider_request_id IS NOT NULL GROUP BY 1,2 ORDER BY 1 DESC,2`, [organizationId, from, to]),
    dbPool.query(`SELECT count(*) FILTER (WHERE p.provider_request_id IS NOT NULL)::int requests,
       count(*) FILTER (WHERE p.provider_request_id IS NOT NULL AND p.status='successful')::int confirmed,
       COALESCE(sum(p.amount_ugx) FILTER (WHERE p.provider_request_id IS NOT NULL AND p.status='successful'),0)::bigint confirmed_ugx,
       count(*) FILTER (WHERE p.provider_request_id IS NOT NULL AND (p.needs_review OR p.reviewed_at IS NOT NULL))::int exceptions,
       count(*) FILTER (WHERE p.provider_request_id IS NULL AND p.status='pending')::int manual_waiting
     FROM customer_payments p WHERE ${range}`, [organizationId, from, to]),
    dbPool.query(`SELECT p.id,p.amount_ugx,p.provider,p.payer_phone,p.status,p.provider_status,p.provider_message,p.provider_amount_ugx,p.review_reason,
       p.provider_request_id,p.provider_reference,p.created_at,p.last_checked_at,ci.invoice_number,u.full_name customer_name
     FROM customer_payments p JOIN customer_invoices ci ON ci.id=p.invoice_id JOIN customer_profiles cp ON cp.id=p.customer_id JOIN users u ON u.id=cp.user_id
     WHERE p.organization_id=$1::uuid AND (p.needs_review OR (p.status='pending' AND p.provider_request_id IS NOT NULL))
     ORDER BY p.needs_review DESC,p.created_at`, [organizationId]),
  ]);
  const t = totals.rows[0];
  return {
    totals: { ...t, exception_rate: t.requests ? Math.round((t.exceptions / t.requests) * 1000) / 10 : null },
    days: days.rows,
    open: open.rows,
  };
}

/** The payments behind a reconciliation period, for matching against the provider's statement. */
export async function mobileMoneyStatement(organizationId: string, from: string, to: string) {
  return (await dbPool.query(`SELECT ${KAMPALA_DAY}::text AS day,p.created_at,p.provider,p.provider_environment,p.provider_request_id,p.provider_reference,
     p.payer_phone,p.amount_ugx,p.status,p.provider_status,p.receipt_number,p.needs_review,p.review_reason,ci.invoice_number,u.full_name customer_name
   FROM customer_payments p JOIN customer_invoices ci ON ci.id=p.invoice_id JOIN customer_profiles cp ON cp.id=p.customer_id JOIN users u ON u.id=cp.user_id
   WHERE p.organization_id=$1::uuid AND p.provider IN ('mtn_momo','airtel_money') AND ${KAMPALA_DAY} BETWEEN $2::date AND $3::date
   ORDER BY p.created_at,p.id`, [organizationId, from, to])).rows;
}
