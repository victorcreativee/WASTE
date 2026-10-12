# Kampala Waste Management mobile app

This is the installed mobile application for Kampala Waste Management field teams. It is separate from the responsive browser system but uses the same authentication and organization-scoped APIs as the web platform.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_API_BASE_URL` to the URL the phone can reach. Use the computer's LAN IP during local testing, not `localhost` on a physical phone.
3. Use Node.js 22.13 or newer.
4. Run `npm install`, then `npm start`.
5. Open the project in an Expo development build or emulator and sign in with an active `driver`, `supervisor`, `recycling_collector`, or `recycling_sales` account.

The app routes each role to a dedicated workspace:

- Drivers receive assigned routes, customer stops, collection confirmation, GPS proof, and exception recording.
- Supervisors receive company-scoped trip, team, status, and customer-progress monitoring.
- Recycling field workers receive daily buying, materials, suppliers, GPS purchase proof, and purchase history.
- Recycling industrial sales staff receive available stock, saved industry buyers, sale recording, sales history, and their receivables position.

Company administration, sorting, full accounting, and finance remain in the responsive web workspace.

## Install on physical phones

The application must point to a public HTTPS API. Configure the EAS environment variable `EXPO_PUBLIC_API_BASE_URL` in both the `preview` and `production` environments before creating a cloud build.

- Android direct install: run `npm run build:preview:android`, open the generated EAS link on the phone, and install the APK.
- iPhone direct install: register the phone with `eas device:create`, then run `npm run build:preview:ios` and open the generated EAS link on that registered phone.
- App Store and Google Play: run `npm run build:production`, then `npm run submit:production` after the store records and developer accounts are ready.

Preview builds are for controlled installation. Production builds are distributed through TestFlight/App Store and Google Play.
