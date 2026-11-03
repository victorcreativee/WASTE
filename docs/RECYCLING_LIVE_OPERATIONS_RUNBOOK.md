# Recycling company live-operations runbook

This runbook applies once a recycling company records real cash, purchases,
stock, expenses or sales. Treat that organization as production data even while
other platform features are still being developed.

## Non-negotiable controls

- Do not use reset-company, delete-day, seed, migration test or preview-account
  tools against the live organization.
- Do not edit the production database manually. Correct business records through
  the application so the audit trail remains complete.
- Do not deploy from an uncommitted working tree. Build and test one release in
  staging, take a verified backup, then deploy during a quiet business period.
- Never share passwords, `.env` files, database URLs or backup files through chat.
- A backup on the application server is not enough. Copy encrypted backups to a
  second protected location with restricted access.

## Daily opening check

1. Confirm the previous business day is closed.
2. Count physical office cash and manager float separately.
3. Compare both amounts with Finance in Kampala WMS.
4. Review pending/offline records on every active field device. Bring each device
   online and wait until it reports a successful sync before starting new work.
5. Resolve a mismatch before issuing new float or recording new purchases.

Run the read-only server audit for the company:

```bash
cd services/waste-service
DATABASE_URL='postgresql://...' npm run audit:recycling-live -- --organization <company-uuid>
```

The command does not alter records. It checks cash, manager float, stock ranges,
tenant isolation and stale server-side sync requests. An offline device that has
not yet contacted the server is outside the server audit, so the device sync
screen must also be checked.

## Daily closing check

1. Confirm every purchase has the correct supplier, material, kilograms, unit
   price, expenses, payment state and recorder.
2. Confirm every sale has the correct buyer, kilograms, price, expenses and
   payment state.
3. Count physical remaining stock and investigate material-level differences.
4. Reconcile office cash, float issued, float spent/returned, expenses and
   receipts. Do not close the day while there is an unexplained difference.
5. Count physical office cash and the manager's remaining float separately.
   The close workflow refuses a count that does not match the ledger; record a
   traceable correction first instead of hiding the variance in the closing note.
6. Bring all field devices online, wait for sync completion, and rerun the
   read-only audit.
7. Close the business day while online. Closing and reopening are deliberately
   never queued offline because another device may still hold unsynchronized
   work. Reopening a closed day should require a documented
   reason and company-administrator approval.

## Backup and recovery

Create a backup:

```bash
infrastructure/production/backup.sh
```

Prove that the newest backup can be restored into a disposable database:

```bash
infrastructure/production/verify-backup.sh
```

Or verify a specific dump:

```bash
infrastructure/production/verify-backup.sh backups/kampala_wms-YYYYmmdd-HHMMSS.dump
```

The verification script validates the checksum, restores into a uniquely named
temporary database, checks critical tables and finance functions, and then drops
only that temporary database. A successful `pg_dump` alone is not evidence that
recovery works.

Perform an off-server restore rehearsal at least monthly and record the date,
operator, backup timestamp, result and recovery duration.

## Release procedure while real money is active

1. Freeze feature changes for the release candidate.
2. Apply it to a staging copy of production data with secrets removed.
3. Run `scripts/release-check.sh`. Do not waive failed finance, migration, mobile,
   sync or backup checks.
4. Test the exact recycling workflows: login, purchase, grouped purchase,
   supplier payment, manager float, expense, sorting, sale, receipt, reports,
   offline creation, reconnect and duplicate prevention.
5. Obtain a daily reconciliation and close/sync all devices.
6. Run the deployment. It backs up and performs a disposable restore test before
   applying migrations.
7. Run the live audit and one read-only UI review after deployment.

`SKIP_BACKUP`, `SKIP_RESTORE_TEST`, and `ALLOW_DIRTY_DEPLOY` are emergency
overrides, not normal release options. Their use must be documented.

## Incident response

If money, stock or synchronization looks wrong:

1. Stop recording new transactions for the affected organization; do not reset
   or delete data.
2. Keep devices online but do not repeatedly resubmit the same operation.
3. Record the user, device, time, displayed error, operation reference and the
   physical cash/stock count. Do not include passwords.
4. Take and verify a backup before attempting a correction.
5. Run the read-only audit and preserve service logs for the affected time.
6. Correct through a reviewed application workflow. If code is required, test it
   against a restored copy first and retain the audit trail.

