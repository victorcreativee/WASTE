# Kampala WMS Android tablet deployment

This runbook is for the official recycling-company Android application. The preview build is a directly installable APK. The production build is an Android App Bundle for Google Play.

## What works offline

- A user first signs in online with their existing Kampala WMS work account.
- The authenticated session and role are protected by Android secure storage.
- Recycling collectors can record purchases, material, supplier, kilograms, price, payment state, costs, notes and optional GPS while offline.
- Recycling sales staff can record approved material sales while offline.
- Recycling field managers can supervise purchases, sorting, stock, workers and attendance without receiving company-administration or unrestricted finance access.
- Drivers can update assigned trips and customer outcomes offline.
- Supervisors and company administrators can reopen the last synchronized company records without internet.
- Operational writes enter the local SQLite outbox and replay in order when connectivity returns.
- Every queued write has an idempotency key to prevent duplicate server records.

Payments, credentials, permits, staff access changes and official weighbridge verification remain online-only because they require live authorization.

## One-time build preparation

1. Install Node.js 22.13 or newer.
2. From `apps/recycling-mobile`, run `npm install`.
3. Sign in to the Expo account that owns the app: `npx eas-cli@latest login`.
4. Confirm the account: `npx eas-cli@latest whoami`.
5. Link the project once: `npx eas-cli@latest init`.
6. In the EAS `preview` and `production` environments set:
   - `EXPO_PUBLIC_API_BASE_URL=https://kampalawms.com`
   - `EXPO_PUBLIC_WEB_BASE_URL=https://kampalawms.com`

Do not put passwords, database credentials or private API keys in any `EXPO_PUBLIC_` variable.

## Build and install the APK

1. Run `npm run build:preview:android`.
2. When EAS finishes, open the build URL on the Android tablet.
3. Download the APK and allow installation from the browser when Android asks.
4. Install **Kampala Waste Management** and open it.
5. Keep internet on for the first sign-in. Use the same active credentials as the server system.
6. Open the recycling workspace and pull to refresh once. This initializes the device cache.

## Prove offline operation before business use

1. While online, confirm the correct company, materials and suppliers are visible.
2. Turn on airplane mode.
3. Close and reopen the app. It should reopen the saved authenticated workspace.
4. Record a clearly labelled test purchase. The app must show that one change is waiting to synchronize.
5. Restore internet and press **Sync now**, or wait for automatic synchronization.
6. Verify the test purchase appears once—not twice—in the hosted recycling workspace.
7. Repeat with one test sale using a recycling-sales account.

Do not uninstall the app, clear its storage, factory-reset the tablet or sign in as another person while records are still waiting to synchronize.

## Production release

Run `npm run build:production:android` to create the signed AAB for Google Play. Use internal testing in Play Console before promoting it to production. Keep the preview APK for company-controlled tablets and testing only.

## Updating the app

Native dependency or permission changes require a new APK/AAB. JavaScript and asset-only updates can be delivered with EAS Update after the Expo project is linked and `npx eas-cli@latest update:configure` has been completed.

- Test a release on company tablets: `npm run update:preview -- --message "Describe the tested change"`
- Publish the approved release: `npm run update:production -- --message "Describe the approved change"`
- An installed app checks for published updates at launch. A manager can also press **Check updates** in the tablet workspace and restart when prompted.

Never publish a production update until the offline purchase, sorting, stock, sale and synchronization checks above pass. Native changes still require a newly signed build.

## Create a recycling field manager

1. Sign in as the recycling-company administrator.
2. Open **Staff management**.
3. Choose **Add staff** and select **Field operations manager**.
4. Enter a unique work email and temporary password, then create the account.
5. The manager signs in online once on each tablet or desktop to initialize its encrypted offline data.

The manager can supervise field purchasing, sorting, inventory, workers, attendance and operational reports. Company credentials, permits, payroll, unrestricted finance and industrial-sales control remain with the authorized company administrator or sales role.

## Device policy for official use

- Require a tablet screen lock and Android device encryption.
- Give every worker a separate Kampala WMS account; never share credentials.
- Synchronize at the beginning and end of every shift.
- Keep Android date and time on automatic.
- Do not use rooted devices.
- Review pending/conflicting items before closing the daily operation.
