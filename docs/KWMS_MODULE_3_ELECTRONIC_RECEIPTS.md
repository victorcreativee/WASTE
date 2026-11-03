# KWMS Module 3 — Electronic collection receipts

Concept note KWMS-CN-001-2026, module 3 and Phase 1: a numbered, tamper-evident receipt for every collection, sent to
the client by SMS, with a signed daily export for KCCA.

## How it works

- **Issued by the database.** When a household stop becomes `completed` (driver app or any other path), the trigger on
  `customer_collection_stops` calls `issue_collection_receipt()` in the same transaction. A completion cannot exist
  without its receipt, and completing a stop again never issues a second one.
- **Serial numbers.** One platform-wide format set by KCCA (`receipt_settings.serial_format`, default
  `{ORG}-{YYYY}-{SEQ7}`, e.g. `NJC-2026-0000123`). `{ORG}` is the operator's code (`receipt_series.code`, generated
  from the company name and changeable by KCCA). The sequence is gapless per operator per Kampala year.
  Changing the format or a code affects only receipts issued afterwards.
- **Append-only.** `collection_receipts`, `collection_receipt_voids` and `collection_receipt_exports` reject UPDATE,
  DELETE and TRUNCATE. A receipt issued in error is voided with a reason (company admin); it stays in the ledger and
  in the export.
- **Hash chain.** Each receipt's `record_hash` is SHA-256 over the previous receipt's hash and the receipt's fields
  (`collection_receipt_payload()`). `verify_collection_receipt_chain(org)` recomputes the chain and reports the first
  altered receipt — this catches edits made by someone who switched the triggers off.
- **SMS.** The receipt is posted to the household's `/my` notifications and, when the household has a phone number,
  queued as an SMS linking to `/r/<serial>`. Unlike reminders this is not optional for the company or household. The
  stop-completion endpoint sends it immediately; the 30-second worker retries failures.
- **Public check.** `/r/<serial>` (API: `GET /api/waste/public/receipts/:serial`) shows whether a receipt is genuine,
  voided or altered, without the phone number and with the household name shortened. It can be printed or saved as PDF.
- **Daily KCCA export.** Every 10 minutes the worker files, for each finished Kampala day since the operator's first
  receipt, one JSON file of that day's receipts and voids, signed with Ed25519. Missed days are caught up after
  downtime. Public key: `GET /api/waste/public/receipts/signing-key`.

## Screens

- Company: **KCCA regulation → Collection receipts** (`/dashboard/receipts`): ledger, SMS delivery, voids, ledger
  check, daily exports with signatures.
- KCCA: **Regulation → Collection receipts** (`/dashboard/receipt-audit`): operators, export gaps, ledger checks,
  city-wide receipt search, serial format, operator codes, public key.

## Configuration

`RECEIPT_SIGNING_KEY` — base64 of 32 random bytes; required in production (the service refuses to start without it,
and `compose.yaml` requires it). Without it, development uses a fixed public development key and the KCCA page warns.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep the key stable: KCCA verifies past exports with its public key. Each export also stores the public key it was
signed with, so rotation does not break older files.

## Verifying an export (KCCA side)

```js
const { verify, createPublicKey } = require("crypto");
const ok = verify(null, fs.readFileSync("receipts.json"), createPublicKey(sig.publicKey), Buffer.from(sig.signature, "base64"));
```

## Not covered yet

- Receipts start at migration 111; earlier collections are not backfilled.
- Commercial collections that are not household stops (`collection_jobs` without customer stops) are not receipted.
- KCCA has not yet confirmed its serial format (concept note action 4); the default is a placeholder KCCA can change.
- Database superusers can still disable triggers; the hash chain detects such edits but cannot prevent them.
