# Schedule-to-dispatch automation — Phase 4C

## Delivered

The organization no longer has to create an area job and then separately remember to plan its customer stops.

- **Plan next 30 days** creates the dated jobs for an active schedule and immediately attaches every eligible customer location to each new occurrence.
- Assigning a manually created job also plans its eligible customer stops automatically.
- Repeating schedule planning preserves existing occurrences and does not duplicate jobs or customer stops.
- New automated occurrences have a database-enforced unique key. Historical duplicate rows remain unchanged and auditable.
- Assignment rejects a maintenance/inactive vehicle, a vehicle with a compliance document expired before the job date, and an off-duty/inactive driver.
- Dispatch feedback states how many jobs were created, existing dates retained, and customer stops planned.

Customer eligibility remains controlled by the active provider relationship, zone, customer/location status, current contract, linked subscription, and active compatible package.

## UI consistency

The Dispatch & collections page now uses the shared page header and feedback components, consistent blue action hierarchy, smaller tab treatment, and organization terminology. The manual customer-stop action remains as a safe refresh/recovery control for eligibility changes after a job was initially planned.

## Test guide

1. Sign in as the organization administrator.
2. Confirm an active customer in the chosen zone has an active provider relationship, package-linked current contract, and active subscription.
3. Open **Dispatch & collections → Schedules** and create or choose an active schedule.
4. Select **Plan next 30 days**.
5. Read the success feedback: it reports created jobs, dates already retained, and automatically planned customer stops.
6. Open **Jobs** and confirm each new job displays its customer-stop total.
7. Select **Plan next 30 days** again. It must create zero duplicates and retain the existing dates.
8. Create a manual job, assign an available truck and available driver, and confirm customer stops are attached automatically.
9. Put a test vehicle into maintenance and confirm assignment is rejected. Repeat with an off-duty driver.
10. Add an expired compliance document to a test vehicle and confirm it cannot be assigned to a later job.

## Verification

- Migration `030_schedule_job_automation.sql` validated and applied locally; existing jobs were unchanged.
- Full real PostgreSQL and HTTP rollback suite: 360 assertions passed.
- Frontend and waste-service TypeScript checks passed.
- Frontend lint and repository whitespace checks passed.
- All generated test jobs, customers, and financial fixtures were rolled back.

## Still required for full unattended automation

This phase automates a user-triggered planning horizon. A production scheduler/worker, holiday/calendar exceptions, capacity-aware optimization, live GPS, offline driver synchronization, evidence file storage, and notification delivery are still separate release gates. The system must not claim those capabilities until implemented and operationally supported.
