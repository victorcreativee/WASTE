# Fleet Control UI consistency

Fleet Control now renders inside the shared application shell. It therefore has the same role-aware sidebar, sticky global header, signed-in user context, logout control, responsive mobile module menu, page width, and background as the rest of the organization system.

The fleet-specific dark banner was replaced by the shared page hierarchy. Status filters are a flat tab row, the vehicle selector uses compact table-like rows instead of rounded cards, statuses use the shared status component, and the selected vehicle uses the system blue accent. Fleet maintenance, documents, fuel, finance links, API calls, and routes were not changed.

## Quick test

1. Restart the frontend and sign in as a company administrator.
2. Open **Fleet control** from the sidebar.
3. Confirm the organization sidebar and global header remain visible and **Fleet control** is highlighted.
4. At a narrow browser width, confirm the sidebar becomes the shared **Menu** control.
5. Filter and search vehicles, select a row, change its availability, and open all four detail tabs.
6. Confirm maintenance, document, and fuel forms retain their existing behavior.

Frontend lint and TypeScript checks passed.
