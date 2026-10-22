# Kampala Waste Management mobile app

This is the installed mobile application for Kampala Waste Management field teams. It is separate from the responsive browser system but uses the same authentication and organization-scoped APIs as the web platform.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_API_BASE_URL` to the API URL the phone can reach and `EXPO_PUBLIC_WEB_BASE_URL` to the hosted web platform. Use the computer's LAN IP during local testing, not `localhost` on a physical phone.
3. Use Node.js 22.13 or newer.
4. Run `npm install`, then `npm start`.
5. Open the project in Expo Go, a development build, or an emulator and sign in with an active Kampala WMS account.

The app routes each role to a dedicated workspace:

- Drivers receive assigned routes, customer stops, collection confirmation, GPS proof, and exception recording.
- Supervisors receive company-scoped trip, team, status, and customer-progress monitoring.
- Recycling field workers receive daily buying, materials, suppliers, GPS purchase proof, and purchase history.
- Recycling industrial sales staff receive available stock, saved industry buyers, sale recording, sales history, and their receivables position.
- Company administrators receive a landscape-ready tablet operations hub with cached trips, customers, vehicles, material activity, synchronization status, and access to the full hosted platform.
- KCCA, platform administration, and weighbridge accounts can use the same tablet shell while server authorization continues to control every record and action.

The **Full platform** button opens the responsive hosted workspace inside the installed app. It intentionally uses its own server sign-in instead of copying a native access token into a browser surface. This preserves the server's normal security boundary.

## Offline field work

After a successful online sign-in, the app keeps the latest role-scoped workspace on the device. Drivers can continue route progress and customer outcomes, recycling buyers can record purchases, and industrial sales staff can record sales while connectivity is unavailable.

- Operational records are stored in the device SQLite outbox and shown immediately as local work.
- Connectivity is monitored automatically. Pending records replay in creation order when the API is reachable.
- Every replay carries a stable idempotency key, so retrying the same action cannot create a duplicate server record.
- Pending and conflicting records are isolated by signed-in email. A different user cannot synchronize another user's work.
- Payment settlement, permit/access administration and other sensitive approval workflows remain online-only.
- Signing out does not delete unsynchronized operational records. Sign back in with the same account to finish synchronization.

## Install on physical phones

The application must point to public HTTPS services. Configure both `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_WEB_BASE_URL` in the EAS `preview` and `production` environments before creating a cloud build.

- Android direct install: run `npm run build:preview:android`, open the generated EAS link on the phone, and install the APK.
- iPhone direct install: register the phone with `eas device:create`, then run `npm run build:preview:ios` and open the generated EAS link on that registered phone.
- App Store and Google Play: run `npm run build:production`, then `npm run submit:production` after the store records and developer accounts are ready.

Preview builds are for controlled installation. Production builds are distributed through TestFlight/App Store and Google Play.

For the official Android tablet checklist, first-online initialization, offline acceptance test and production release procedure, follow [ANDROID_TABLET_DEPLOYMENT.md](./ANDROID_TABLET_DEPLOYMENT.md).
