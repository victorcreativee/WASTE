import { ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { MobileUser } from "../lib/auth-session";
import { CompanyTabletWorkspace } from "./CompanyTabletWorkspace";
import { RecyclingPurchaseWorkspace } from "./RecyclingPurchaseWorkspace";
import { RecyclingSalesWorkspace } from "./RecyclingSalesWorkspace";

type Module = "control" | "purchasing" | "sales";

/**
 * Keeps the manager inside one native application while reusing the established
 * operational workspaces and their API contracts. No data or business logic is
 * duplicated here; this component only coordinates role-level navigation.
 *
 * A module stays mounted once it has been opened, so switching back is instant and
 * keeps any half-filled form; the module refreshes itself quietly when shown again.
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
  const [opened, setOpened] = useState<Set<Module>>(() => new Set<Module>(["control"]));
  const [controlPage, setControlPage] = useState<"dashboard" | "operations">("dashboard");

  function open(next: Module) {
    setOpened((current) => (current.has(next) ? current : new Set(current).add(next)));
    setModule(next);
  }
  function openControl(page: "dashboard" | "operations" = "dashboard") {
    setControlPage(page);
    open("control");
  }

  const pane = (id: Module, content: ReactNode) =>
    opened.has(id) ? (
      <View key={id} style={[styles.pane, module !== id && styles.hidden]}>
        {content}
      </View>
    ) : null;

  return (
    <View style={styles.pane}>
      {pane(
        "control",
        <CompanyTabletWorkspace
          token={token}
          user={user}
          onLogout={onLogout}
          initialTab={controlPage}
          active={module === "control"}
          onOpenPurchasing={() => open("purchasing")}
          onOpenSales={() => open("sales")}
        />,
      )}
      {pane(
        "purchasing",
        <RecyclingPurchaseWorkspace
          token={token}
          user={user}
          onLogout={onLogout}
          active={module === "purchasing"}
          onOpenOperations={openControl}
          onOpenSales={() => open("sales")}
        />,
      )}
      {pane(
        "sales",
        <RecyclingSalesWorkspace
          token={token}
          user={user}
          onLogout={onLogout}
          active={module === "sales"}
          onOpenOperations={openControl}
          onOpenPurchasing={() => open("purchasing")}
        />,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  hidden: { display: "none" },
});
