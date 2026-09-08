# Navigation and content UX consistency

Delivered 4 September 2026 as a focused usability pass before Phase 3B relationship workflows.

## Outcome

- Organization navigation is organized by the user's work: Overview, Operations, People & customers, Commercial, Finance, Supply, Insights and Administration.
- Supervisor, KCCA, customer and driver menus use role-appropriate groups and wording instead of inheriting one long generic list.
- The sidebar is the single location for primary module navigation. Repeated “back to organization overview” links no longer render on individual pages.
- The top bar is limited to global orientation and account actions: current module, workspace context, signed-in identity and logout.
- Desktop navigation scrolls independently on shorter screens. Mobile navigation preserves the same groups and identifies the current module before expansion.
- Customer management has a clear page purpose and primary action. Creating a customer opens a focused modal; the searchable, paginated customer register remains the main page content.
- The existing visual language is preserved: square-edged controls, restrained blue action color, amber orientation accent, small table text and minimal surfaces.

This pass changes information architecture and presentation only. It does not change routes, roles, backend permissions, customer records, contracts or financial data.

## Files

- `apps/admin-web/src/components/layout/AppShell.tsx`
- `apps/admin-web/src/components/layout/OrganizationWorkspaceNav.tsx`
- `apps/admin-web/src/app/dashboard/customer-service/page.tsx`

## Test guide

Restart or allow the frontend development server to refresh, then use separate browser tabs/profiles for each existing test role.

1. Company administrator: confirm grouped sidebar sections appear in the order above; open several modules and verify only one item is highlighted. Confirm the top bar shows the current module and Organization workspace.
2. Open Customer management. Confirm there is no repeated “back to overview” link. Search the register, change rows per page and move between pages.
3. Select Add customer. Confirm a modal appears above the unchanged directory. Confirm Cancel and Close dismiss it without creating data. Validation should prevent incomplete submission. A successful test creation should close the modal, clear the form, refresh the register and show feedback.
4. Supervisor: confirm operational modules are grouped separately from customer, resources and reporting work. Staff/access entries appear only when the effective permission endpoint returns their required grants.
5. KCCA administrator: confirm Control room remains the overview and city oversight is distinct from GIS coverage.
6. Citizen and driver: confirm each receives a short role-focused menu rather than organization administration links.
7. At a narrow browser width, open the module menu and confirm the same labels/groups are present and links remain usable. At a short desktop height, confirm the sidebar scrolls without moving page content.
8. Sign out and confirm the global Logout action returns to login. No module action should be duplicated in the top bar.

Automated verification completed: frontend ESLint, TypeScript with incremental output disabled, 7 frontend tests and `git diff --check` passed. The local login screen rendered successfully; authenticated role-by-role visual execution requires the user's existing test credentials and is not claimed here.
