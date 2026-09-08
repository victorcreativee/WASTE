# First System Admin bootstrap

The first Platform/System Admin is not seeded or hardcoded. It is created once from the local browser after database migrations are applied.

Open `http://localhost:3000/login`. When no System Admin exists, the page displays **Start secure setup**. This opens `http://localhost:3000/setup/system-admin`.

Enter the administrator's name, email, password and confirmation. The server hashes the password with bcrypt before insertion. The password must be 12–72 bytes and contain uppercase, lowercase, numeric and symbol characters.

Safety rules:

- The web endpoint accepts only a local-browser origin and loopback server connection.
- A database advisory lock prevents two simultaneous first-admin creations.
- The page and endpoint refuse to create an account after any System Admin exists, including after an ordinary service restart.
- It refuses duplicate emails and missing role migrations.
- The System Admin is platform-scoped and is not attached to KCCA or a private organization.

After bootstrap, do not use database scripts to create ordinary accounts. The authenticated Platform Admin workflow must create KCCA administrators, activate permit-approved organizations, and issue the first Organization Admin invitation. Organization Admins then create their own staff through organization-scoped access management.

The terminal bootstrap command remains an emergency deployment option, but it is not required for this local installation. A database reset intentionally reopens first-time setup because it removes the administrator record.
