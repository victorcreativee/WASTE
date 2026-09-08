# Collection exceptions — Phase 4B driver reporting

## Delivered

Drivers now have a clear **Could not collect** action on each unresolved household pickup. It opens a focused mobile modal, requires a reason, and sends the record to the organization as a pending exception. The original planned stop remains immutable enough for service history: its status becomes `skipped`, its completion timestamp and driver are retained, and the exception reason is stored separately from ordinary completion notes.

Supported reasons are blocked access, customer unavailable, waste not ready, unsafe conditions, vehicle access, and other. **Other** requires a written explanation. Residents can see the truthful skipped service outcome without seeing another customer's data.

Migration `029_customer_stop_exceptions.sql` was validated and applied locally. It only adds exception fields and an organization review index; existing collection rows were unchanged.

## Test steps

1. Restart the waste service and frontend.
2. Sign in as an organization administrator, create/assign an area job, and use **Plan customer stops**.
3. In a separate browser profile, sign in as the assigned driver and start the route/job.
4. Mark the area stop arrived, then select **Could not collect** beside a household.
5. Choose a clear reason. Select **Other reason** and confirm that a note becomes required.
6. Submit. The household row must show `skipped` and the readable reason.
7. Confirm the remaining household pickups can still be completed and the area job can finish after all are resolved.
8. Sign in as that resident in another browser profile and confirm their own service history shows the skipped outcome only.

## Verification

- Full PostgreSQL and HTTP rollback suite: 352 assertions passed.
- Waste service and frontend TypeScript checks passed.
- Frontend lint and repository whitespace checks passed.
- Test fixtures were rolled back; no persistent test or financial data was created.

## Next increment

The tenant-safe supervisor review workflow is now complete. A dedicated **Exceptions** tab in Dispatch & collections shows a flat review table with the customer, address, original service, driver reason, review note, and eligible replacement jobs. An exception can be resolved or moved only to a pending/assigned job belonging to the same organization and zone, on or after the original date. Rescheduling creates one replacement customer stop and links the original exception to it. Cross-organization review is denied. KCCA does not receive this private customer-level organization queue. Photo/file evidence storage and notifications remain separate later work.

Full regression coverage is now 355 PostgreSQL/HTTP assertions.

### Supervisor review test

1. Sign in as the company administrator or supervisor and open **Dispatch & collections → Exceptions**.
2. Confirm each pending row shows the customer/location, original service date and zone, and the driver reason.
3. Enter a review note and select **Close case** to resolve an exception without creating new work.
4. For another exception, choose a replacement job. The selector must list only pending/assigned jobs for the same zone and a valid date.
5. Select **Reschedule**. The row leaves the pending queue and one customer stop is added to the chosen job.
6. Sign in as another organization and confirm it cannot read or review the exception.
