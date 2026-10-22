# Kampala WMS Desktop

Cross-platform secure shell for the existing Kampala Waste Management System. The production application remains server-authoritative; approved operational actions can be stored in an encrypted local queue and synchronized when connectivity returns.

## Development

Start the web/API stack from the repository root, then run `npm run dev` here. Set `KWMS_SERVER_URL` to use another server. Production defaults to `https://kampalawms.com`.

## Offline boundary

The queue accepts selected recycling, driver, collection outcome, issue-reporting, and operating-expense endpoints. Payments, contracts, permits, access control, payroll approval, weighbridge verification and other authoritative decisions require a live connection.

## Offline finance and insights

After an online sign-in, the desktop application encrypts the latest billing overview, expenses, financial position, accounts payable, payroll, weighbridge tonnage, and current-month organization report in the local SQLite database. These pages remain readable offline. New operating expenses can be recorded offline and synchronize with duplicate protection when connectivity returns.

## Desktop updates

Packaged applications check `https://kampalawms.com/desktop-updates/mac` shortly after launch and every six hours. The Desktop Sync Centre and offline workspace show the installed version and provide **Check updates**, **Download update**, and **Restart and install** actions. Updates preserve the encrypted SQLite database and pending synchronization outbox. Publish the generated DMG/ZIP, block map, and `latest-mac.yml` from `release/` to that server path. Public macOS updates require a Developer ID signature and Apple notarization.
