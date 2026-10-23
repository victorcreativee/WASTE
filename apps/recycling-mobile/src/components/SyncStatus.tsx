import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  discardMobileOutbox,
  listMobileOutbox,
  MobileOutboxItem,
  retryMobileOutbox,
  subscribeSync,
  syncMobileOutbox,
  SyncState,
  watchConnectivity,
} from "../lib/mobile-api";
import { Banner, Button, EmptyState, Icon, IconButton, StatusBadge } from "../ui/kit";
import { Tone, color, radius, shadow, space, tone, type } from "../ui/theme";

/** What an offline record is, in the words field staff use. */
function describe(item: MobileOutboxItem) {
  const path = item.endpoint;
  if (path.endsWith("/recycling/lots")) return { title: "Material purchase", icon: "cube-outline" as const };
  if (path.endsWith("/recycling/sales")) return { title: "Industrial sale", icon: "trending-up-outline" as const };
  if (/\/recycling\/lots\/[^/]+\/paid$/.test(path)) return { title: "Supplier payment", icon: "wallet-outline" as const };
  if (/\/recycling\/sales\/[^/]+\/paid$/.test(path)) return { title: "Sale payment received", icon: "cash-outline" as const };
  if (path.endsWith("/recycling/manager-float")) return { title: "Field money movement", icon: "wallet-outline" as const };
  if (path.endsWith("/finance/expenses")) return { title: "Expense", icon: "receipt-outline" as const };
  if (path.endsWith("/recycling/sorting")) return { title: "Sorting batch", icon: "funnel-outline" as const };
  if (path.endsWith("/recycling/stock-adjustments")) return { title: "Stock adjustment", icon: "swap-vertical-outline" as const };
  if (path.endsWith("/recycling/daily-closures")) return { title: "Daily close", icon: "lock-closed-outline" as const };
  if (path.includes("/customer-collection-stops/")) return { title: "Customer collection", icon: "home-outline" as const };
  if (path.includes("/driver-route-stops/") || path.includes("/driver-jobs/")) return { title: "Route stop", icon: "location-outline" as const };
  if (path.includes("/driver-routes/") && path.endsWith("/start")) return { title: "Trip started", icon: "play-circle-outline" as const };
  if (path.includes("/driver-routes/")) return { title: "Trip update", icon: "navigate-outline" as const };
  if (path.includes("/driver-job-problems")) return { title: "Problem report", icon: "alert-circle-outline" as const };
  return { title: path.split("/").filter(Boolean).slice(-1)[0]?.replaceAll("-", " ") || "Saved change", icon: "document-outline" as const };
}

export function SyncStatus({
  token,
  email,
  onSynced,
}: {
  token: string;
  email: string;
  onSynced?: () => void;
}) {
  const [current, setCurrent] = useState<SyncState>({ online: true, pending: 0, conflicts: 0, syncing: false });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MobileOutboxItem[]>([]);
  const insets = useSafeAreaInsets();
  useEffect(() => subscribeSync(setCurrent), []);
  // Screens pass onSynced inline; reading it through a ref keeps one network subscription for the life of the screen.
  const onSyncedRef = useRef(onSynced);
  useEffect(() => { onSyncedRef.current = onSynced; });
  useEffect(() => watchConnectivity(token, email, () => onSyncedRef.current?.()), [token, email]);

  async function showQueue() {
    setItems(await listMobileOutbox(email));
    setOpen(true);
  }
  async function syncNow() {
    await syncMobileOutbox(token, email).catch(() => 0);
    setItems(await listMobileOutbox(email));
    onSynced?.();
  }
  async function retry(item: MobileOutboxItem) {
    await retryMobileOutbox(item.id, email);
    await syncMobileOutbox(token, email).catch(() => 0);
    setItems(await listMobileOutbox(email));
    onSynced?.();
  }
  function discard(item: MobileOutboxItem) {
    Alert.alert("Discard this change?", "It has not reached the server and will be permanently removed from this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void discardMobileOutbox(item.id, email).then(() => listMobileOutbox(email)).then(setItems) },
    ]);
  }

  const state: { label: string; tone: Tone; icon: React.ComponentProps<typeof Icon>["name"] } =
    current.conflicts ? { label: "Needs review", tone: "danger", icon: "alert-circle" }
      : !current.online ? { label: current.pending ? `Offline · ${current.pending}` : "Offline", tone: "warning", icon: "cloud-offline-outline" }
        : current.syncing || current.pending ? { label: current.syncing ? "Syncing…" : `${current.pending} to sync`, tone: "action", icon: "sync-outline" }
          : { label: "Up to date", tone: "success", icon: "checkmark-circle" };

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Synchronization: ${state.label}`} onPress={() => void showQueue()}
        style={({ pressed }) => [s.pill, { backgroundColor: tone[state.tone].soft }, pressed && { opacity: 0.7 }]}>
        <Icon name={state.icon} size={15} tint={tone[state.tone].ink} />
        <Text style={[s.pillText, { color: tone[state.tone].ink }]} numberOfLines={1}>{state.label}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={[s.sheet, { paddingTop: Platform.OS === "android" ? insets.top : 0, paddingBottom: insets.bottom }]}>
          <View style={s.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={type.title}>Saved on this phone</Text>
              <Text style={type.small}>Work recorded here is sent to the server in the order it was made.</Text>
            </View>
            <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={s.list}>
            {!current.online ? <Banner tone="warning" text="The server can't be reached right now. Keep working; everything below is sent automatically when the connection returns." /> : null}
            {current.conflicts ? <Banner tone="danger" text="Some changes were refused by the server. Read the reason on each one, then retry or discard it." /> : null}
            {items.length ? <Button title={current.syncing ? "Sending…" : current.online ? "Sync now" : "Try sending now"} icon="sync-outline" loading={current.syncing} onPress={() => void syncNow()} /> : null}
            {items.map((item) => {
              const what = describe(item);
              const failed = item.status === "failed" || Boolean(item.last_error);
              return (
                <View key={item.id} style={s.item}>
                  <View style={s.itemTop}>
                    <View style={[s.itemIcon, { backgroundColor: failed ? color.dangerSoft : color.actionSoft }]}><Icon name={what.icon} size={18} tint={failed ? color.danger : color.action} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={type.heading}>{what.title}</Text>
                      <Text style={type.caption}>{new Date(item.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                    </View>
                    <StatusBadge label={failed ? "Needs review" : item.status === "syncing" ? "Sending" : "Waiting"} tone={failed ? "danger" : "warning"} />
                  </View>
                  {item.last_error ? <Text style={s.itemError}>{item.last_error}</Text> : null}
                  <View style={s.actions}>
                    <Button title="Retry" icon="refresh-outline" variant="secondary" onPress={() => void retry(item)} style={{ flex: 1, minHeight: 42 }} />
                    <Button title="Discard" variant="danger" onPress={() => discard(item)} style={{ flex: 1, minHeight: 42 }} />
                  </View>
                </View>
              );
            })}
            {!items.length ? <EmptyState icon="checkmark-done-outline" title="Everything is synchronized" text="Nothing on this phone is waiting to be sent." /> : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 150 },
  pillText: { fontSize: 12, fontWeight: "600" },
  sheet: { flex: 1, backgroundColor: color.page },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: space.md, padding: space.xl, paddingBottom: space.md },
  list: { padding: space.xl, paddingTop: space.sm, gap: space.md },
  item: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow.card },
  itemTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  itemIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  itemError: { ...type.small, color: color.danger, backgroundColor: color.dangerSoft, borderRadius: radius.sm, padding: space.sm },
  actions: { flexDirection: "row", gap: space.sm },
});
