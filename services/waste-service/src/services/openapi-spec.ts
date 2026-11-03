import { env } from "../config/env";

// The OpenAPI 3.1 description of /api/v1 (migration 116), served at /api/v1/openapi.json for API clients and tools.

const string = { type: "string" } as const, integer = { type: "integer" } as const, number = { type: "string", description: "Decimal as text" } as const;
const date = { type: "string", format: "date" } as const, time = { type: "string", format: "date-time" } as const;
const nullable = (schema: object) => ({ oneOf: [schema, { type: "null" }] });
const list = (item: object, paged = false) => ({
  type: "object", required: ["data"],
  properties: { data: { type: "array", items: item }, meta: paged ? { $ref: "#/components/schemas/Page" } : { type: "object" } },
});
const query = (name: string, description: string, schema: object, required = true) => ({ name, in: "query", required, description, schema });
const range = [query("from", "First day (Kampala)", date), query("to", "Last day, at most 92 days after from", date)];
const paging = [query("page", "Page number", { ...integer, minimum: 1, default: 1 }, false), query("pageSize", "Rows per page", { ...integer, minimum: 1, maximum: 500, default: 100 }, false)];
const responses = (schema: object) => ({
  200: { description: "OK", content: { "application/json": { schema } } },
  400: { $ref: "#/components/responses/Error" }, 401: { $ref: "#/components/responses/Error" },
  403: { $ref: "#/components/responses/Error" }, 429: { $ref: "#/components/responses/Error" },
});
const get = (summary: string, scope: string | null, parameters: object[], schema: object) => ({
  get: { summary, ...(scope ? { description: `Requires the \`${scope}\` scope.` } : {}), parameters, responses: responses(schema) },
});

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Kampala Waste Management System — open API",
      version: "1.0.0",
      description: [
        "Read-only access to KCCA-verified waste data. Keys are issued in KWMS: a collection company's administrator issues",
        "keys for its own data; KCCA issues partner keys (NEMA, development finance, carbon verifiers) with city-wide access.",
        "Send the key as `Authorization: Bearer kwms_...`. Each key has a per-minute limit, reported in `X-RateLimit-*` headers.",
        "Days and months are Kampala time. Weights are kilograms unless named tonnes.",
      ].join(" "),
    },
    servers: [{ url: `${env.publicAppUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    paths: {
      "/me": get("The key in use: who holds it, its scopes and limits", null, [], { type: "object", properties: { data: { type: "object" } } }),
      "/operators": get("Licensed collection companies and their KCCA permits", "operators:read", [], list({
        type: "object", properties: { id: string, name: string, permit_number: nullable(string), permit_status: { type: "string", enum: ["approved", "expired", "suspended", "revoked", "none"] },
          valid_from: nullable(date), valid_until: nullable(date), divisions: { type: "array", items: string } },
      })),
      "/tonnage": get("Weighed tonnage per day, operator and facility (completed weighbridge tickets)", "tonnage:read", range, list({
        type: "object", properties: { date, operator_id: string, operator: string, facility: string, facility_kind: string, loads: integer, net_kg: number },
      })),
      "/load-certificates": get("Load certificates issued for weighed loads, with composition when recorded", "certificates:read", [...range, ...paging], list({
        type: "object", properties: { certificate_number: string, verification_code: string, operator_id: string, operator: string, ticket_number: string,
          facility: string, facility_kind: string, registration: string, date, gross_kg: number, tare_kg: number, net_kg: number, issued_at: time,
          revoked_at: nullable(time), revoked_reason: nullable(string), record_hash: string,
          composition_method: nullable({ type: "string", enum: ["visual_estimate", "sample_sort"] }),
          composition: nullable({ type: "object", additionalProperties: { type: "number" }, description: "Percent by waste stream" }) },
      }, true)),
      "/carbon-baseline": get("Monthly carbon baseline: tonnes landfilled and diverted by stream, with methane potential", "carbon:read",
        [query("from", "First month", { type: "string", pattern: "^\\d{4}-\\d{2}$" }), query("to", "Last month", { type: "string", pattern: "^\\d{4}-\\d{2}$" })], list({
          type: "object", properties: { month: string, operator_id: string, operator: string, destination: { type: "string", enum: ["landfill", "composting", "materials_recovery", "recycling"] },
            stream: string, loads: integer, tonnes: number, measured_tonnes: number, ch4_tonnes: number, co2e_tonnes: number, factor_version: integer },
        })),
      "/receipts": get("One day of the company's own collection receipts (company keys only)", "receipts:read", [query("date", "Kampala day the receipts were issued", date), ...paging], list({
        type: "object", properties: { serial_number: string, chain_position: integer, issued_at: time, collected_at: time, customer_name: string, location_label: string,
          zone_name: nullable(string), collected_weight_kg: nullable(number), truck_plate: nullable(string), driver_name: nullable(string),
          previous_hash: nullable(string), record_hash: string, voided: { type: "boolean" }, void_reason: nullable(string), voided_at: nullable(time) },
      }, true)),
    },
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "kwms_<id>_<secret>" } },
      schemas: {
        Page: { type: "object", properties: { page: integer, pageSize: integer, total: integer } },
        Error: { type: "object", properties: { error: { type: "object", properties: { code: string, message: string } } } },
      },
      responses: { Error: { description: "Refused", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
    },
  };
}
