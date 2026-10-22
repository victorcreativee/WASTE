import { useState } from "react";
import { MobileUser } from "../lib/auth-session";
import { CompanyTabletWorkspace } from "./CompanyTabletWorkspace";
import { RecyclingPurchaseWorkspace } from "./RecyclingPurchaseWorkspace";
import { RecyclingSalesWorkspace } from "./RecyclingSalesWorkspace";

type Module = "control" | "purchasing" | "sales";

/**
 * Keeps the manager inside one native application while reusing the established
 * operational workspaces and their API contracts. No data or business logic is
 * duplicated here; this component only coordinates role-level navigation.
 */
export function RecyclingManagerWorkspace({
  token,
  user,
  onLogout,
}: {
  token: string;
  user: MobileUser;
  onLogout: () => Promise<void>;
}) {
  const [module, setModule] = useState<Module>("control");
  const [controlPage, setControlPage] = useState<"dashboard" | "operations">("dashboard");

  function openControl(page: "dashboard" | "operations" = "dashboard") {
    setControlPage(page);
    setModule("control");
  }

  if (module === "purchasing") {
    return (
      <RecyclingPurchaseWorkspace
        token={token}
        user={user}
        onLogout={onLogout}
        onOpenOperations={openControl}
        onOpenSales={() => setModule("sales")}
      />
    );
  }
  if (module === "sales") {
    return (
      <RecyclingSalesWorkspace
        token={token}
        user={user}
        onLogout={onLogout}
        onOpenOperations={openControl}
        onOpenPurchasing={() => setModule("purchasing")}
      />
    );
  }
  return (
    <CompanyTabletWorkspace
      token={token}
      user={user}
      onLogout={onLogout}
      initialTab={controlPage}
      onOpenPurchasing={() => setModule("purchasing")}
      onOpenSales={() => setModule("sales")}
    />
  );
}
