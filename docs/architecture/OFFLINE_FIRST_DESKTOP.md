# Offline-first desktop operation

## User workflow

1. The first sign-in on a computer requires the central Kampala WMS server.
2. A successful online sign-in provisions a local SQLite user record and operational cache.
3. The desktop app derives a salted `scrypt` password verifier. It never stores the password.
4. If the server cannot be reached later, the user signs in through the local offline workspace using the same credentials.
5. Approved driver and recycling-field actions are written to the SQLite outbox immediately.
6. When connectivity returns, the desktop app rotates its central session, submits outbox records in creation order, and reopens the online workspace to retrieve current server data.

## Local protection

- Database: `kampala-wms.sqlite3` in Electron's per-user application-data directory.
- File permission: owner read/write only (`0600`).
- SQLite WAL mode, foreign keys and a busy timeout protect transactional writes.
- Profile data, refresh credentials, cached operational payloads and outbox bodies are encrypted with Electron `safeStorage`, backed by the operating-system credential store.
- Password verification uses a unique 32-byte salt and a 64-byte `scrypt` result with timing-safe comparison.
- Five failed offline attempts lock the local account for five minutes.
- Offline authentication requires central re-verification after 30 days.
- Central revocation, inactive accounts, inactive organizations, or an invalid refresh session disable local access when the desktop reconnects.

## Synchronization and integrity

- Every outbox record has a UUID used as the server idempotency key.
- Equivalent submissions made within ten seconds reuse the existing pending record.
- The server persists idempotency results through migration `084_desktop_sync_idempotency.sql`.
- Records synchronize oldest first.
- HTTP `409` is preserved as a conflict and is not automatically overwritten; a user must review and retry it.
- Successful records remain visible for seven days before local cleanup.
- Online pages refresh from the central server after reconnection, updating local snapshots as the user opens operational workspaces.

## Offline scope

Available offline:

- Secure local login for previously verified users.
- Driver route reference, customer list, route start, collection completion, and missed-collection outcomes.
- Recycling material and supplier reference data and field purchase entry.
- Encrypted outbox visibility and synchronization status.

Always online:

- Payments and billing confirmation.
- Contracts and permits.
- Payroll and access-control changes.
- KCCA weighbridge verification.
- Compliance and platform-administration decisions.

These boundaries prevent high-risk official records from being authorized by an unconnected device.
