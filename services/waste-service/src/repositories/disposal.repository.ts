import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import type { Period } from "../services/recycling-oversight.rules";
import {
  DISPOSAL_RULES, DISPOSAL_STATES, DisposalState, EXCEPTION_STATES, EXPLANATION_REASONS, ExplanationReason, StateCounts,
  disposalStanding, disposalStateSql, dueTrips, explanationError, verificationRate,
} from "../services/disposal.rules";
import { linkWeighbridgeTrip } from "./weighbridge.repository";
import { notifyOrganization, notifyRole } from "../services/notify";

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const num = (value: unknown) => Number(value ?? 0);
const STATE = disposalStateSql("f", "$3");

export async function today() {
  return (await dbPool.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
}

// ---------- Facilities ----------

export async function facilities(activeOnly: boolean) {
  return (await dbPool.query(
    `SELECT code,name,kind,is_active FROM disposal_facilities WHERE ($1::boolean=false OR is_active) ORDER BY is_active DESC,name`, [activeOnly])).rows;
}

export async function saveFacility(input: { code: string; name: string; kind: string; isActive: boolean }) {
  return (await dbPool.query(
    `INSERT INTO disposal_facilities(code,name,kind,is_active) VALUES($1,$2,$3,$4)
     ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,is_active=EXCLUDED.is_active,updated_at=CURRENT_TIMESTAMP
     RETURNING code,name,kind,is_active`, [input.code, input.name, input.kind, input.isActive])).rows[0];
}

// ---------- Shared figures ----------

/** Trip counts by disposal state and verified weight, per collector, for trips in the period (and not before firstDate). */
async function stateCounts(period: Period, organizationId: string | null) {
  const rows = (await dbPool.query(
    `SELECT f.organization_id,${STATE} AS state,COUNT(*)::int AS n,COALESCE(SUM(f.net_kg) FILTER(WHERE f.ticket_status='completed'),0) AS kg
     FROM trip_disposal_facts f
     WHERE f.route_date BETWEEN $1::date AND $2::date AND f.route_date>=$4::date AND ($5::uuid IS NULL OR f.organization_id=$5::uuid)
     GROUP BY 1,2`,
    [period.from, period.to, DISPOSAL_RULES.graceHours, DISPOSAL_RULES.firstDate, organizationId])).rows;
  const byOrg = new Map<string, { counts: StateCounts; verified_kg: number }>();
  for (const row of rows) {
    const entry = byOrg.get(row.organization_id) ?? { counts: {}, verified_kg: 0 };
    entry.counts[row.state as DisposalState] = row.n;
    entry.verified_kg += num(row.kg);
    byOrg.set(row.organization_id, entry);
  }
  return byOrg;
}

/** Completed tickets in the period that belong to no trip and that KCCA has not accepted, past the linking window. */
async function unlinkedTicketCounts(period: Period, organizationId: string | null) {
  const rows = (await dbPool.query(
    `SELECT organization_id,COUNT(*)::int AS n,COALESCE(SUM(net_kg),0) AS kg FROM weighbridge_transactions
     WHERE trip_id IS NULL AND status='completed' AND no_trip_accepted_at IS NULL
       AND operation_date BETWEEN $1::date AND $2::date AND operation_date>=$4::date
       AND COALESCE(departure_at,arrival_at)<CURRENT_TIMESTAMP-make_interval(hours=>$3::int)
       AND ($5::uuid IS NULL OR organization_id=$5::uuid)
     GROUP BY 1`,
    [period.from, period.to, DISPOSAL_RULES.unlinkedTicketHours, DISPOSAL_RULES.firstDate, organizationId])).rows;
  return new Map(rows.map(row => [row.organization_id as string, { n: row.n as number, kg: num(row.kg) }]));
}

async function weighbridgeByFacility(period: Period, organizationId: string | null) {
  return (await dbPool.query(
    `SELECT f.code,f.name,COUNT(w.id)::int AS tickets,COALESCE(SUM(w.net_kg),0)::float AS net_kg
     FROM weighbridge_transactions w JOIN disposal_facilities f ON f.code=w.facility_code
     WHERE w.status='completed' AND w.operation_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR w.organization_id=$3::uuid)
     GROUP BY 1,2 ORDER BY net_kg DESC`, [period.from, period.to, organizationId])).rows;
}

function summarise(counts: StateCounts, verifiedKg: number, unlinked: { n: number; kg: number } | undefined) {
  const rate = verificationRate(counts);
  const states = Object.fromEntries(DISPOSAL_STATES.map(state => [state, counts[state] ?? 0])) as Record<DisposalState, number>;
  return {
    states,
    completed_trips: DISPOSAL_STATES.reduce((sum, state) => sum + states[state], 0),
    due_trips: dueTrips(counts),
    exceptions: EXCEPTION_STATES.reduce((sum, state) => sum + states[state], 0),
    verified_kg: verifiedKg,
    verification_rate: rate,
    standing: disposalStanding(rate),
    unlinked_tickets: unlinked?.n ?? 0,
    unlinked_kg: unlinked?.kg ?? 0,
  };
}

// ---------- Company ----------

export async function requireCollector(organizationId: string | null | undefined) {
  if (!organizationId) throw fail(403, "Disposal records belong to a waste collection company");
  const org = (await dbPool.query("SELECT id,name FROM organizations WHERE id=$1::uuid AND type='waste_collection_company'", [organizationId])).rows[0];
  if (!org) throw fail(403, "Disposal records belong to a waste collection company");
  return org as { id: string; name: string };
}

export async function companySummary(organizationId: string, period: Period) {
  const [counts, unlinked, facilitiesUsed] = await Promise.all([
    stateCounts(period, organizationId), unlinkedTicketCounts(period, organizationId), weighbridgeByFacility(period, organizationId),
  ]);
  const own = counts.get(organizationId);
  return { period, rules: DISPOSAL_RULES, ...summarise(own?.counts ?? {}, own?.verified_kg ?? 0, unlinked.get(organizationId)), facilities: facilitiesUsed };
}

const TRIP_COLUMNS = `f.trip_id,f.organization_id,o.name AS organization_name,f.trip_number,r.name AS route_name,f.route_date::text AS route_date,f.completed_at,
  f.plate_number,${STATE} AS state,f.ticket_id,f.ticket_number,f.net_kg,f.facility,f.declared_ticket,f.declared_kg,
  f.explanation_id,f.explanation_status,f.explanation_reason,f.explanation_details,f.explanation_review_note`;

export async function listTrips(period: Period, filter: { organizationId: string | null; states: string[] | null }, page?: Page) {
  return queryPage(
    `SELECT * FROM (SELECT ${TRIP_COLUMNS} FROM trip_disposal_facts f JOIN collection_routes r ON r.id=f.trip_id JOIN organizations o ON o.id=f.organization_id
       WHERE f.route_date BETWEEN $1::date AND $2::date AND f.route_date>=$4::date AND ($5::uuid IS NULL OR f.organization_id=$5::uuid)) t
     WHERE ($6::text[] IS NULL OR t.state=ANY($6::text[])) ORDER BY t.route_date DESC,t.completed_at DESC,t.trip_id`,
    [period.from, period.to, DISPOSAL_RULES.graceHours, DISPOSAL_RULES.firstDate, filter.organizationId, filter.states], page);
}

export async function listTickets(period: Period, filter: { organizationId: string | null; unlinkedOnly: boolean }, page?: Page) {
  return queryPage(
    `SELECT w.id,w.organization_id,o.name AS organization_name,w.ticket_number,w.facility,w.facility_code,w.registration,w.driver_name,
       w.operation_date::text AS operation_date,w.arrival_at,w.departure_at,w.net_kg,w.status,w.trip_id,r.trip_number,
       w.no_trip_reason,w.no_trip_accepted_at,
       (w.trip_id IS NULL AND w.status='completed' AND w.no_trip_accepted_at IS NULL) AS unlinked,
       (COALESCE(w.departure_at,w.arrival_at)<CURRENT_TIMESTAMP-make_interval(hours=>$3::int)) AS past_window
     FROM weighbridge_transactions w JOIN organizations o ON o.id=w.organization_id LEFT JOIN collection_routes r ON r.id=w.trip_id
     WHERE w.operation_date BETWEEN $1::date AND $2::date AND w.status<>'voided' AND ($4::uuid IS NULL OR w.organization_id=$4::uuid)
       AND ($5::boolean=false OR (w.trip_id IS NULL AND w.status='completed' AND w.no_trip_accepted_at IS NULL
         AND w.operation_date>=$6::date AND COALESCE(w.departure_at,w.arrival_at)<CURRENT_TIMESTAMP-make_interval(hours=>$3::int)))
     ORDER BY w.operation_date DESC,w.arrival_at DESC,w.id`,
    [period.from, period.to, DISPOSAL_RULES.unlinkedTicketHours, filter.organizationId, filter.unlinkedOnly, DISPOSAL_RULES.firstDate], page);
}

async function tripState(client: PoolClient, tripId: string, organizationId: string) {
  return (await client.query(
    `SELECT f.trip_number,f.route_date::text AS route_day,${STATE} AS state FROM trip_disposal_facts f WHERE f.trip_id=$1::uuid AND f.organization_id=$2::uuid`,
    [tripId, organizationId, DISPOSAL_RULES.graceHours])).rows[0];
}

export async function submitExplanation(organizationId: string, userId: string, tripId: string,
  input: { reason: ExplanationReason; details: string; relatedTicketId?: string | null }) {
  const problem = explanationError(input);
  if (problem) throw fail(400, problem);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM collection_routes WHERE id=$1::uuid FOR UPDATE", [tripId]);
    const trip = await tripState(client, tripId, organizationId);
    if (!trip) throw fail(404, "Completed trip not found");
    if (["verified", "weighing"].includes(trip.state)) throw fail(409, "This trip already has a KCCA weighbridge ticket");
    if (["explained", "explanation_review"].includes(trip.state)) throw fail(409, "This trip already has an explanation");
    const row = (await client.query(
      `INSERT INTO trip_disposal_explanations(trip_id,organization_id,reason,details,related_ticket_id,submitted_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tripId, organizationId, input.reason, input.details.trim(), input.relatedTicketId ?? null, userId])).rows[0];
    const company = (await client.query("SELECT name FROM organizations WHERE id=$1::uuid", [organizationId])).rows[0];
    await notifyRole(client, "kcca_admin", {
      category: "disposal", severity: "info", title: `Disposal explanation from ${company?.name || "a company"}`,
      body: `${trip.trip_number || "A trip"} on ${trip.route_day}: ${EXPLANATION_REASONS[input.reason]}. Review it in Disposal verification.`,
      link: "/dashboard/disposal-oversight", dedupeKey: `disposal-explanation:${row.id}`,
    }, organizationId);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A company links one of its own unlinked KCCA tickets to one of its completed trips (the vehicle must match). */
export async function linkOwnTicket(organizationId: string, userId: string, ticketId: string, tripId: string) {
  const ticket = (await dbPool.query(
    "SELECT id,trip_id,status,no_trip_accepted_at FROM weighbridge_transactions WHERE id=$1::uuid AND organization_id=$2::uuid", [ticketId, organizationId])).rows[0];
  if (!ticket) throw fail(404, "Weighbridge ticket not found");
  if (ticket.trip_id) throw fail(409, "This ticket is already linked to a trip");
  if (ticket.status === "voided") throw fail(409, "This ticket was voided");
  if (ticket.no_trip_accepted_at) throw fail(409, "KCCA accepted this ticket as a load without a trip");
  const trip = (await dbPool.query("SELECT status FROM collection_routes WHERE id=$1::uuid AND organization_id=$2::uuid", [tripId, organizationId])).rows[0];
  if (!trip || trip.status !== "completed") throw fail(400, "Choose a completed trip of your company");
  try {
    return await linkWeighbridgeTrip(ticketId, tripId, userId);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw fail(409, "That trip already has a weighbridge ticket");
    throw error;
  }
}

// ---------- KCCA ----------

export async function cityOverview(period: Period) {
  const [orgs, counts, unlinked, byFacility, awaiting] = await Promise.all([
    dbPool.query(
      `SELECT o.id,o.name,p.permit_number FROM organizations o
       LEFT JOIN LATERAL(SELECT a.permit_number FROM organization_permit_applications a WHERE a.organization_id=o.id AND a.permit_number IS NOT NULL
         ORDER BY (a.status IN('approved','suspended')) DESC,a.valid_until DESC NULLS LAST,a.created_at DESC LIMIT 1) p ON true
       WHERE o.type='waste_collection_company' AND o.is_active ORDER BY o.name`),
    stateCounts(period, null), unlinkedTicketCounts(period, null), weighbridgeByFacility(period, null),
    dbPool.query("SELECT organization_id,COUNT(*)::int AS n FROM trip_disposal_explanations WHERE status='submitted' GROUP BY 1"),
  ]);
  const waiting = new Map(awaiting.rows.map(row => [row.organization_id as string, row.n as number]));
  const companies = orgs.rows.map(org => {
    const own = counts.get(org.id);
    return { id: org.id, name: org.name, permit_number: org.permit_number, explanations_waiting: waiting.get(org.id) ?? 0,
      ...summarise(own?.counts ?? {}, own?.verified_kg ?? 0, unlinked.get(org.id)) };
  }).filter(company => company.completed_trips || company.unlinked_tickets || company.explanations_waiting);
  const order = { action: 0, watch: 1, good: 2, no_trips: 3 } as const;
  companies.sort((a, b) => order[a.standing] - order[b.standing] || (a.verification_rate ?? 101) - (b.verification_rate ?? 101) || a.name.localeCompare(b.name));
  const total: StateCounts = {};
  let verifiedKg = 0;
  for (const entry of counts.values()) {
    verifiedKg += entry.verified_kg;
    for (const state of DISPOSAL_STATES) total[state] = (total[state] ?? 0) + (entry.counts[state] ?? 0);
  }
  const allUnlinked = [...unlinked.values()].reduce((sum, value) => ({ n: sum.n + value.n, kg: sum.kg + value.kg }), { n: 0, kg: 0 });
  return {
    period, rules: DISPOSAL_RULES,
    city: { ...summarise(total, verifiedKg, allUnlinked), explanations_waiting: [...waiting.values()].reduce((a, b) => a + b, 0) },
    facilities: byFacility, companies,
  };
}

export async function listExplanations(filter: { organizationId: string | null; status: string }, page?: Page) {
  return queryPage(
    `SELECT e.id,e.trip_id,e.organization_id,o.name AS organization_name,r.trip_number,r.route_date::text AS route_date,t.plate_number,
       e.reason,e.details,e.related_ticket_id,w.ticket_number AS related_ticket_number,w.net_kg AS related_ticket_kg,
       e.status,e.submitted_at,s.full_name AS submitted_by_name,e.reviewed_at,e.review_note
     FROM trip_disposal_explanations e JOIN organizations o ON o.id=e.organization_id JOIN collection_routes r ON r.id=e.trip_id
     LEFT JOIN waste_trucks t ON t.id=r.truck_id LEFT JOIN weighbridge_transactions w ON w.id=e.related_ticket_id LEFT JOIN users s ON s.id=e.submitted_by
     WHERE e.status=$1 AND ($2::uuid IS NULL OR e.organization_id=$2::uuid) ORDER BY e.submitted_at,e.id`,
    [filter.status, filter.organizationId], page);
}

export async function reviewExplanation(id: string, userId: string, action: "accept" | "reject", note: string | undefined) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query(
      `UPDATE trip_disposal_explanations SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=CURRENT_TIMESTAMP
       WHERE id=$1::uuid AND status='submitted' RETURNING *`,
      [id, action === "accept" ? "accepted" : "rejected", note?.trim() || null, userId])).rows[0];
    if (!row) throw fail(409, "This explanation was already reviewed or does not exist");
    const trip = (await client.query("SELECT trip_number FROM collection_routes WHERE id=$1", [row.trip_id])).rows[0];
    await notifyOrganization(client, row.organization_id, ["company_admin"], {
      category: "disposal", severity: action === "accept" ? "info" : "warning",
      title: action === "accept" ? `Disposal explanation accepted: ${trip?.trip_number ?? "trip"}` : `Disposal explanation rejected: ${trip?.trip_number ?? "trip"}`,
      body: action === "accept" ? "KCCA accepted your explanation; the trip counts as accounted for."
        : `KCCA: ${row.review_note}. Link the trip's weighbridge ticket or explain it again.`,
      link: "/dashboard/disposal", dedupeKey: `disposal-review:${row.id}`,
    });
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function acceptTicketWithoutTrip(id: string, userId: string, reason: string) {
  const row = (await dbPool.query(
    `UPDATE weighbridge_transactions SET no_trip_reason=$2,no_trip_accepted_by=$3,no_trip_accepted_at=CURRENT_TIMESTAMP,updated_by=$3,updated_at=CURRENT_TIMESTAMP
     WHERE id=$1::uuid AND trip_id IS NULL AND status='completed' AND no_trip_accepted_at IS NULL RETURNING id,ticket_number,no_trip_reason,no_trip_accepted_at`,
    [id, reason.trim(), userId])).rows[0];
  if (!row) throw fail(409, "Only a completed ticket without a trip can be accepted");
  return row;
}

// ---------- Scheduled check ----------

/**
 * One daily notice per collector that has trips without a disposal record or tickets without a trip, so the company can
 * act before KCCA does. Runs inside the hourly notification checks.
 */
export async function notifyDisposalGaps(client: PoolClient) {
  const day = (await client.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
  const gaps = (await client.query(
    `WITH trips AS (
       SELECT f.organization_id,COUNT(*)::int AS n FROM trip_disposal_facts f
       WHERE f.route_date>=$2::date AND f.route_date>=CURRENT_DATE-30 AND ${disposalStateSql("f", "$1")} IN('unverified','declared') GROUP BY 1),
     tickets AS (
       SELECT organization_id,COUNT(*)::int AS n FROM weighbridge_transactions
       WHERE trip_id IS NULL AND status='completed' AND no_trip_accepted_at IS NULL AND operation_date>=$2::date AND operation_date>=CURRENT_DATE-30
         AND COALESCE(departure_at,arrival_at)<CURRENT_TIMESTAMP-make_interval(hours=>$3::int) GROUP BY 1)
     SELECT o.id,COALESCE(trips.n,0) AS trips,COALESCE(tickets.n,0) AS tickets FROM organizations o
     LEFT JOIN trips ON trips.organization_id=o.id LEFT JOIN tickets ON tickets.organization_id=o.id
     WHERE o.is_active AND o.type='waste_collection_company' AND (trips.n>0 OR tickets.n>0)`,
    [DISPOSAL_RULES.graceHours, DISPOSAL_RULES.firstDate, DISPOSAL_RULES.unlinkedTicketHours])).rows;
  for (const gap of gaps) {
    const parts = [
      gap.trips ? `${gap.trips} completed trip${gap.trips === 1 ? "" : "s"} without a KCCA weighbridge ticket` : "",
      gap.tickets ? `${gap.tickets} weighbridge ticket${gap.tickets === 1 ? "" : "s"} not linked to a trip` : "",
    ].filter(Boolean);
    await notifyOrganization(client, gap.id, ["company_admin", "supervisor"], {
      category: "disposal", severity: "warning", title: "Disposal records need attention",
      body: `${parts.join(" and ")} in the last 30 days. Link each ticket to its trip or explain the trip in Disposal records.`,
      link: "/dashboard/disposal", dedupeKey: `disposal-gaps:${gap.id}:${day}`,
    });
  }
  return gaps.length;
}
