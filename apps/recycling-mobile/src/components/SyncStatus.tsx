import { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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

export function SyncStatus({
  token,
  email,
  onSynced,
}: {
  token: string;
  email: string;
  onSynced?: () => void;
}) {
  const [current, setCurrent] = useState<SyncState>({
    online: true,
    pending: 0,
    conflicts: 0,
    syncing: false,
  });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MobileOutboxItem[]>([]);
  useEffect(() => subscribeSync(setCurrent), []);
  useEffect(
    () => watchConnectivity(token, email, onSynced),
    [token, email, onSynced],
  );
  async function showQueue() {
    setItems(await listMobileOutbox(email));
    setOpen(true);
  }
  async function retry(item: MobileOutboxItem) {
    await retryMobileOutbox(item.id, email);
    if (current.online) await syncMobileOutbox(token, email);
    setItems(await listMobileOutbox(email));
    onSynced?.();
  }
  function discard(item: MobileOutboxItem) {
    Alert.alert(
      "Discard offline change?",
      "This unsynchronized operation will be permanently removed from this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () =>
            void discardMobileOutbox(item.id, email)
              .then(() => listMobileOutbox(email))
              .then(setItems),
        },
      ],
    );
  }
  const indicator =
    current.online && !current.pending && !current.conflicts ? (
      <Pressable onPress={() => void showQueue()} style={s.good}>
        <View style={s.dot} />
        <Text style={s.goodText}>Up to date</Text>
      </Pressable>
    ) : (
      <View
        style={[
          s.bar,
          !current.online && s.offline,
          current.conflicts > 0 && s.conflict,
        ]}
      >
        <Pressable onPress={() => void showQueue()} style={{ flex: 1 }}>
          <Text style={s.title}>
            {current.online
              ? current.conflicts
                ? "Sync needs attention"
                : "Synchronizing work"
              : "Working offline"}
          </Text>
          <Text style={s.text}>
            {current.conflicts
              ? `${current.conflicts} item${current.conflicts === 1 ? "" : "s"} must be reviewed online`
              : `${current.pending} change${current.pending === 1 ? "" : "s"} waiting to sync`}
          </Text>
        </Pressable>
        {current.online && current.pending ? (
          <Pressable
            disabled={current.syncing}
            onPress={() =>
              void syncMobileOutbox(token, email).then(() => onSynced?.())
            }
            style={s.button}
          >
            <Text style={s.buttonText}>
              {current.syncing ? "Syncing…" : "Sync now"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  return (
    <>
      {indicator}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={s.modal}>
          <View style={s.modalHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle}>Synchronization activity</Text>
              <Text style={s.text}>
                Review operations saved on this device.
              </Text>
            </View>
            <Pressable onPress={() => setOpen(false)}>
              <Text style={s.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.list}>
            {items.map((item) => (
              <View key={item.id} style={s.item}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemTitle}>
                    {item.method} {item.endpoint.split("/").slice(-2).join("/")}
                  </Text>
                  <Text style={s.itemMeta}>
                    {item.status.replaceAll("_", " ")} ·{" "}
                    {new Date(item.created_at).toLocaleString("en-GB")}
                  </Text>
                  {item.last_error ? (
                    <Text style={s.itemError}>{item.last_error}</Text>
                  ) : null}
                </View>
                <View style={s.actions}>
                  <Pressable onPress={() => void retry(item)} style={s.retry}>
                    <Text style={s.retryText}>Retry</Text>
                  </Pressable>
                  <Pressable onPress={() => discard(item)} style={s.discard}>
                    <Text style={s.discardText}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            ))}
            {!items.length ? (
              <View style={s.empty}>
                <Text style={s.itemTitle}>Everything is synchronized</Text>
                <Text style={s.text}>No offline changes need attention.</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
const s = StyleSheet.create({
  good: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#16a34a" },
  goodText: { fontSize: 11, color: "#64748b", fontWeight: "700" },
  bar: {
    backgroundColor: "#eaf0fc",
    borderLeftWidth: 4,
    borderLeftColor: "#3156a3",
    padding: 12,
    margin: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  offline: { backgroundColor: "#fff7df", borderLeftColor: "#d97706" },
  conflict: { backgroundColor: "#fff1f2", borderLeftColor: "#dc2626" },
  title: { fontWeight: "800", fontSize: 13, color: "#172033" },
  text: { fontSize: 12, color: "#64748b", marginTop: 2 },
  button: {
    backgroundColor: "#3156a3",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  buttonText: { color: "white", fontWeight: "800", fontSize: 12 },
  modal: { flex: 1, backgroundColor: "#f7f8f5", paddingTop: 20 },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#d8dfeb",
    padding: 20,
  },
  modalTitle: { fontSize: 24, fontWeight: "800", color: "#121827" },
  close: { color: "#3156a3", fontWeight: "800", padding: 10 },
  list: { padding: 20 },
  item: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d8dfeb",
    padding: 15,
    marginBottom: 10,
    flexDirection: "row",
    gap: 12,
  },
  itemTitle: { fontSize: 14, fontWeight: "800", color: "#172033" },
  itemMeta: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 5,
    textTransform: "capitalize",
  },
  itemError: { fontSize: 12, lineHeight: 17, color: "#991b1b", marginTop: 7 },
  actions: { gap: 7 },
  retry: {
    borderWidth: 1,
    borderColor: "#3156a3",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryText: { color: "#3156a3", fontSize: 11, fontWeight: "800" },
  discard: {
    borderWidth: 1,
    borderColor: "#dc2626",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  discardText: { color: "#b91c1c", fontSize: 11, fontWeight: "800" },
  empty: {
    padding: 24,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d8dfeb",
  },
});
