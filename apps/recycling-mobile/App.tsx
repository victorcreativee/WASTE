import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { OperationsWorkspace } from "./src/components/OperationsWorkspace";
import { RecyclingSalesWorkspace } from "./src/components/RecyclingSalesWorkspace";

const API_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
const TOKEN_KEY = "kwms.mobile.accessToken";
const USER_KEY = "kwms.mobile.user";
type Screen = "today" | "buy" | "history" | "account";
type User = { fullName: string; email: string; roles: string[] };
type Material = { id: string; name: string; active: boolean };
type Partner = {
  id: string;
  name: string;
  partner_type: string;
  active: boolean;
};
type Lot = {
  id: string;
  material_type: string;
  source_name: string;
  quantity_kg: string;
  unit_purchase_price_ugx: string;
  collected_on: string;
  quality: string;
  collection_latitude: string | null;
};
type Workspace = {
  organization: { name: string; type: string };
  operations: {
    operatingDate: string;
    isClosed: boolean;
    receivedTodayKg: number;
  };
  materials: Material[];
  partners: Partner[];
  lots: Lot[];
  myActivity?: { purchases?: number; purchasedKg?: number };
};
type PurchaseForm = {
  materialType: string;
  customMaterialType: string;
  supplierPartnerId: string;
  sourceName: string;
  quantityKg: string;
  unitPrice: string;
  quality: "mixed" | "clean" | "sorted" | "contaminated";
  payment: "paid" | "credit";
  paymentReference: string;
  transport: string;
  floatUsed: string;
  notes: string;
};
const emptyPurchase: PurchaseForm = {
  materialType: "",
  customMaterialType: "",
  supplierPartnerId: "",
  sourceName: "",
  quantityKg: "",
  unitPrice: "",
  quality: "mixed",
  payment: "paid",
  paymentReference: "",
  transport: "0",
  floatUsed: "0",
  notes: "",
};

async function api<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let body: any;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { message: raw || "The service returned an unreadable response" };
  }
  if (!response.ok)
    throw new Error(body.message || `Request failed (${response.status})`);
  return body as T;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  secureTextEntry = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "decimal-pad" | "number-pad";
  secureTextEntry?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8390a5"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        style={[styles.input, multiline && styles.textarea]}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      />
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceActive]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [screen, setScreen] = useState<Screen>("today");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PurchaseForm>(emptyPurchase);
  const [position, setPosition] = useState<Location.LocationObject | null>(
    null,
  );

  useEffect(() => {
    (async () => {
      const [savedToken, savedUser] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);
      if (savedToken && savedUser) {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      }
      setBooting(false);
    })().catch(() => setBooting(false));
  }, []);

  async function load(activeToken = token) {
    if (!activeToken) return;
    try {
      setError("");
      const result = await api<{ data: Workspace }>(
        "/api/waste/recycling",
        activeToken,
      );
      setWorkspace(result.data);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Could not load recycling operations";
      setError(message);
      if (/unauthorized|token|401/i.test(message)) await logout();
    }
  }
  // Initial authenticated workspace hydration is intentionally effect-driven.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token) void load(token);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function login() {
    if (!email.trim() || !password)
      return setError("Enter your work email and password.");
    try {
      setLoading(true);
      setError("");
      const result = await api<{
        data: {
          user: { fullName: string; email: string };
          roles: { name: string }[];
          tokens: { accessToken: string };
        };
      }>("/api/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const nextUser = {
        fullName: result.data.user.fullName,
        email: result.data.user.email,
        roles: result.data.roles.map((role) => role.name),
      };
      if (!nextUser.roles.some((role) => ["recycling_collector", "recycling_sales", "driver", "supervisor"].includes(role)))
        throw new Error(
          "This mobile account must be a driver, supervisor, recycling buyer, or industrial sales worker.",
        );
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, result.data.tokens.accessToken),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser)),
      ]);
      setUser(nextUser);
      setToken(result.data.tokens.accessToken);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }
  async function logout() {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    setToken("");
    setUser(null);
    setWorkspace(null);
    setScreen("today");
  }
  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }
  async function useGps() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted")
      return Alert.alert(
        "Location not enabled",
        "You can still save the purchase without GPS proof.",
      );
    setLoading(true);
    try {
      setPosition(
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }),
      );
    } catch {
      Alert.alert(
        "Location unavailable",
        "Move to an open area and try again, or continue without GPS.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function savePurchase() {
    const materialType =
      form.customMaterialType.trim() || form.materialType.trim();
    if (
      !workspace ||
      !materialType ||
      form.sourceName.trim().length < 2 ||
      Number(form.quantityKg) <= 0 ||
      Number(form.unitPrice) < 0
    )
      return setError(
        "Choose a material and enter a valid supplier, weight and price.",
      );
    try {
      setLoading(true);
      setError("");
      await api("/api/waste/recycling/lots", token, {
        method: "POST",
        body: JSON.stringify({
          materialType,
          allowNewMaterial: Boolean(form.customMaterialType.trim()),
          supplierPartnerId: form.supplierPartnerId || undefined,
          sourceName: form.sourceName.trim(),
          quantityKg: Number(form.quantityKg),
          unitPurchasePriceUgx: Number(form.unitPrice),
          collectedOn: workspace.operations.operatingDate,
          quality: form.quality,
          purchasePaymentStatus: form.payment,
          purchasePaymentReference: form.paymentReference.trim() || undefined,
          workerWagesUgx: 0,
          foodUgx: 0,
          transportUgx: Number(form.transport || 0),
          driverFeeUgx: 0,
          otherExpenseUgx: 0,
          managerFloatUsedUgx: Number(form.floatUsed || 0),
          collectionLatitude: position?.coords.latitude,
          collectionLongitude: position?.coords.longitude,
          collectionAccuracyM: position?.coords.accuracy ?? undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      setForm(emptyPurchase);
      setPosition(null);
      await load();
      setScreen("today");
      Alert.alert(
        "Purchase saved",
        "Stock and company accounts have been updated.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save purchase",
      );
    } finally {
      setLoading(false);
    }
  }

  const todayLots = useMemo(
    () =>
      workspace?.lots.filter(
        (item) =>
          String(item.collected_on).slice(0, 10) ===
          workspace.operations.operatingDate,
      ) || [],
    [workspace],
  );
  const total = Number(form.quantityKg || 0) * Number(form.unitPrice || 0);
  if (booting)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3156a3" />
      </View>
    );
  if (!token || !user)
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.loginPage}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>KW</Text>
            </View>
            <Text style={styles.eyebrow}>URBAN WASTE OS</Text>
            <Text style={styles.loginTitle}>Mobile field operations</Text>
            <Text style={styles.subtitle}>
              Drivers, supervisors and recycling field workers sign in with
              the account created by their company administrator.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.loginCard}>
              <Field
                label="Work email"
                value={email}
                onChangeText={setEmail}
                placeholder="buyer@company.com"
                keyboardType="email-address"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <Pressable
                disabled={loading}
                onPress={login}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>
                  {loading ? "Signing in…" : "Sign in securely"}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.apiHint}>Connected to {API_URL}</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );

  if (user.roles.some((role) => ["driver", "supervisor"].includes(role)))
    return <OperationsWorkspace token={token} user={user} onLogout={logout} />;

  if (user.roles.includes("recycling_sales"))
    return <RecyclingSalesWorkspace token={token} user={user} onLogout={logout} />;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.eyebrow}>KAMPALA WASTE MANAGEMENT</Text>
          <Text style={styles.headerTitle}>
            {workspace?.organization.name || "Recycling operations"}
          </Text>
        </View>
        <View style={styles.online}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Connected</Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {screen === "today" && (
          <>
            <Text style={styles.pageTitle}>Today</Text>
            <Text style={styles.subtitle}>
              Your buying activity and the company’s live daily position.
            </Text>
            {workspace?.operations.isClosed ? (
              <Text style={styles.warning}>
                Management has closed today. Purchases are read-only until
                reopened.
              </Text>
            ) : null}
            <View style={styles.metricRow}>
              <View style={styles.metricDark}>
                <Text style={styles.metricLabel}>MY PURCHASES</Text>
                <Text style={styles.metricValue}>
                  {workspace?.myActivity?.purchases ?? todayLots.length}
                </Text>
              </View>
              <View style={styles.metricBlue}>
                <Text style={styles.metricLabelLight}>KG BOUGHT</Text>
                <Text style={styles.metricValueLight}>
                  {Number(
                    workspace?.myActivity?.purchasedKg ??
                      workspace?.operations.receivedTodayKg ??
                      0,
                  ).toLocaleString()}
                </Text>
              </View>
            </View>
            <Pressable
              disabled={workspace?.operations.isClosed}
              onPress={() => setScreen("buy")}
              style={[
                styles.primary,
                workspace?.operations.isClosed && styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>+ Record material purchase</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>Latest purchases</Text>
            {todayLots.slice(0, 5).map((item) => (
              <View key={item.id} style={styles.row}>
                <View>
                  <Text style={styles.rowTitle}>{item.material_type}</Text>
                  <Text style={styles.rowSub}>
                    {item.source_name} · {item.quality}
                  </Text>
                </View>
                <Text style={styles.rowAmount}>
                  {Number(item.quantity_kg).toLocaleString()} kg
                </Text>
              </View>
            ))}
            {!todayLots.length && (
              <Text style={styles.empty}>No purchases recorded today.</Text>
            )}
          </>
        )}
        {screen === "buy" && (
          <>
            <Text style={styles.pageTitle}>New purchase</Text>
            <Text style={styles.subtitle}>
              Record the material at the collection point. Required fields are
              marked.
            </Text>
            <Text style={styles.label}>Material *</Text>
            <View style={styles.chips}>
              {workspace?.materials
                .filter((item) => item.active)
                .map((item) => (
                  <Choice
                    key={item.id}
                    label={item.name}
                    selected={form.materialType === item.name}
                    onPress={() =>
                      setForm((current) => ({
                        ...current,
                        materialType: item.name,
                        customMaterialType: "",
                      }))
                    }
                  />
                ))}
            </View>
            <Field
              label="Material not listed?"
              value={form.customMaterialType}
              onChangeText={(value) =>
                setForm((current) => ({
                  ...current,
                  customMaterialType: value,
                  materialType: value.trim() ? "" : current.materialType,
                }))
              }
              placeholder="Enter another material name"
            />
            <Text style={styles.helperText}>
              A new name is saved to the company catalogue for future use.
            </Text>
            <Text style={styles.label}>Saved supplier (optional)</Text>
            <View style={styles.chips}>
              <Choice
                label="Other"
                selected={!form.supplierPartnerId}
                onPress={() =>
                  setForm((current) => ({ ...current, supplierPartnerId: "" }))
                }
              />
              {workspace?.partners
                .filter(
                  (item) =>
                    item.active &&
                    ["supplier", "both"].includes(item.partner_type),
                )
                .map((item) => (
                  <Choice
                    key={item.id}
                    label={item.name}
                    selected={form.supplierPartnerId === item.id}
                    onPress={() =>
                      setForm((current) => ({
                        ...current,
                        supplierPartnerId: item.id,
                        sourceName: item.name,
                      }))
                    }
                  />
                ))}
            </View>
            <Field
              label="Supplier or collection point *"
              value={form.sourceName}
              onChangeText={(value) =>
                setForm((current) => ({ ...current, sourceName: value }))
              }
            />
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Field
                  label="Weight (kg) *"
                  value={form.quantityKg}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, quantityKg: value }))
                  }
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.col}>
                <Field
                  label="Price / kg *"
                  value={form.unitPrice}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, unitPrice: value }))
                  }
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>MATERIAL AMOUNT</Text>
              <Text style={styles.totalValue}>
                UGX {total.toLocaleString()}
              </Text>
            </View>
            <Text style={styles.label}>Quality</Text>
            <View style={styles.chips}>
              {(["mixed", "clean", "sorted", "contaminated"] as const).map(
                (value) => (
                  <Choice
                    key={value}
                    label={value[0].toUpperCase() + value.slice(1)}
                    selected={form.quality === value}
                    onPress={() =>
                      setForm((current) => ({ ...current, quality: value }))
                    }
                  />
                ),
              )}
            </View>
            <Text style={styles.label}>Payment</Text>
            <View style={styles.chips}>
              <Choice
                label="Paid now"
                selected={form.payment === "paid"}
                onPress={() =>
                  setForm((current) => ({ ...current, payment: "paid" }))
                }
              />
              <Choice
                label="On credit"
                selected={form.payment === "credit"}
                onPress={() =>
                  setForm((current) => ({ ...current, payment: "credit" }))
                }
              />
            </View>
            <Field
              label="Payment reference (optional)"
              value={form.paymentReference}
              onChangeText={(value) =>
                setForm((current) => ({ ...current, paymentReference: value }))
              }
            />
            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Field
                  label="Transport cost"
                  value={form.transport}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, transport: value }))
                  }
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.col}>
                <Field
                  label="Paid from float"
                  value={form.floatUsed}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, floatUsed: value }))
                  }
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <View style={styles.locationCard}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>Collection location</Text>
                <Text style={styles.rowSub}>
                  {position
                    ? `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)} · ±${Math.round(position.coords.accuracy || 0)} m`
                    : "Optional GPS proof"}
                </Text>
              </View>
              <Pressable onPress={useGps} style={styles.secondary}>
                <Text style={styles.secondaryText}>
                  {position ? "Refresh GPS" : "Use GPS"}
                </Text>
              </Pressable>
            </View>
            <Field
              label="Note (optional)"
              value={form.notes}
              onChangeText={(value) =>
                setForm((current) => ({ ...current, notes: value }))
              }
              multiline
            />
            <Pressable
              disabled={loading || workspace?.operations.isClosed}
              onPress={savePurchase}
              style={[
                styles.primary,
                (loading || workspace?.operations.isClosed) && styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>
                {loading ? "Saving…" : "Save purchase"}
              </Text>
            </Pressable>
          </>
        )}
        {screen === "history" && (
          <>
            <Text style={styles.pageTitle}>Purchase history</Text>
            <Text style={styles.subtitle}>
              The latest recycling material purchases recorded for your company.
            </Text>
            {workspace?.lots.slice(0, 50).map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.rowTitle}>{item.material_type}</Text>
                  <Text style={styles.rowAmount}>
                    {Number(item.quantity_kg).toLocaleString()} kg
                  </Text>
                </View>
                <Text style={styles.rowSub}>
                  {new Date(item.collected_on).toLocaleDateString("en-GB")} ·{" "}
                  {item.source_name}
                </Text>
                <Text style={styles.historyMeta}>
                  UGX {Number(item.unit_purchase_price_ugx).toLocaleString()}/kg
                  {item.collection_latitude ? " · GPS recorded" : ""}
                </Text>
              </View>
            ))}
            {!workspace?.lots.length && (
              <Text style={styles.empty}>No purchase history yet.</Text>
            )}
          </>
        )}
        {screen === "account" && (
          <>
            <Text style={styles.pageTitle}>Account</Text>
            <View style={styles.accountCard}>
              <Text style={styles.rowTitle}>{user.fullName}</Text>
              <Text style={styles.rowSub}>{user.email}</Text>
              <Text style={styles.accountCompany}>
                {workspace?.organization.name}
              </Text>
            </View>
            <Pressable onPress={logout} style={styles.logout}>
              <Text style={styles.logoutText}>Sign out</Text>
            </Pressable>
            <Text style={styles.apiHint}>API: {API_URL}</Text>
          </>
        )}
      </ScrollView>
      <View style={styles.tabBar}>
        {(
          [
            ["today", "Today"],
            ["buy", "Buy"],
            ["history", "History"],
            ["account", "Account"],
          ] as [Screen, string][]
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => {
              setError("");
              setScreen(id);
            }}
            style={styles.tab}
          >
            <Text style={[styles.tabText, screen === id && styles.tabActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: "#f6f7f5" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f7f5",
  },
  loginPage: { flexGrow: 1, justifyContent: "center", padding: 28 },
  brandMark: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#151b2b",
    marginBottom: 24,
  },
  brandMarkText: { color: "#f0b35a", fontWeight: "800", fontSize: 16 },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#3156a3",
  },
  loginTitle: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "800",
    color: "#111827",
    marginTop: 10,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    color: "#64748b",
    marginTop: 8,
    marginBottom: 20,
  },
  helperText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: -10,
    marginBottom: 16,
  },
  loginCard: {
    backgroundColor: "white",
    padding: 20,
    borderWidth: 1,
    borderColor: "#dfe4ea",
    marginTop: 12,
  },
  fieldWrap: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "700", color: "#334155", marginBottom: 7 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "white",
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#0f172a",
  },
  textarea: { minHeight: 94, textAlignVertical: "top", paddingTop: 13 },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3156a3",
    paddingHorizontal: 18,
    marginTop: 8,
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "800" },
  secondary: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3156a3",
    paddingHorizontal: 12,
  },
  secondaryText: { color: "#3156a3", fontSize: 13, fontWeight: "800" },
  disabled: { backgroundColor: "#aebbd4" },
  error: {
    backgroundColor: "#fff1f2",
    borderLeftWidth: 4,
    borderLeftColor: "#dc2626",
    color: "#991b1b",
    fontWeight: "700",
    padding: 13,
    marginHorizontal: 20,
    marginTop: 12,
  },
  warning: {
    backgroundColor: "#fff7df",
    borderLeftWidth: 4,
    borderLeftColor: "#d97706",
    padding: 13,
    color: "#92400e",
    fontWeight: "700",
    marginBottom: 18,
  },
  apiHint: {
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 22,
  },
  appHeader: {
    minHeight: 72,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#dfe4ea",
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginTop: 4,
  },
  online: { flexDirection: "row", alignItems: "center", gap: 6 },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#16a34a",
  },
  onlineText: { fontSize: 11, color: "#64748b", fontWeight: "700" },
  page: { padding: 20, paddingBottom: 38 },
  pageTitle: { fontSize: 30, fontWeight: "800", color: "#111827" },
  metricRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  metricDark: {
    flex: 1,
    backgroundColor: "#151b2b",
    padding: 16,
    minHeight: 110,
  },
  metricBlue: {
    flex: 1,
    backgroundColor: "#3156a3",
    padding: 16,
    minHeight: 110,
  },
  metricLabel: { fontSize: 11, fontWeight: "800", color: "#94a3b8" },
  metricLabelLight: { fontSize: 11, fontWeight: "800", color: "#dbeafe" },
  metricValue: {
    fontSize: 33,
    fontWeight: "800",
    color: "white",
    marginTop: 16,
  },
  metricValueLight: {
    fontSize: 33,
    fontWeight: "800",
    color: "white",
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#111827",
    marginTop: 28,
    marginBottom: 8,
  },
  row: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowTitle: { fontSize: 15, fontWeight: "800", color: "#1e293b" },
  rowSub: { fontSize: 12, color: "#64748b", marginTop: 5 },
  rowAmount: { fontSize: 15, fontWeight: "800", color: "#111827" },
  empty: {
    backgroundColor: "white",
    padding: 24,
    textAlign: "center",
    color: "#64748b",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  choice: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "white",
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  choiceActive: { backgroundColor: "#3156a3", borderColor: "#3156a3" },
  choiceText: { fontSize: 13, fontWeight: "700", color: "#475569" },
  choiceTextActive: { color: "white" },
  twoCol: { flexDirection: "row", gap: 12 },
  col: { flex: 1 },
  totalBox: {
    backgroundColor: "#eef4ff",
    borderLeftWidth: 4,
    borderLeftColor: "#3156a3",
    padding: 15,
    marginBottom: 18,
  },
  totalLabel: { fontSize: 11, fontWeight: "800", color: "#64748b" },
  totalValue: {
    fontSize: 25,
    fontWeight: "800",
    color: "#3156a3",
    marginTop: 5,
  },
  locationCard: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#dfe4ea",
    padding: 14,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  historyCard: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    marginBottom: 10,
  },
  historyMeta: { fontSize: 12, color: "#475569", marginTop: 11 },
  accountCard: {
    backgroundColor: "white",
    borderTopWidth: 2,
    borderTopColor: "#3156a3",
    padding: 20,
    marginTop: 18,
  },
  accountCompany: {
    fontSize: 14,
    color: "#3156a3",
    fontWeight: "800",
    marginTop: 18,
  },
  logout: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  logoutText: { color: "#b91c1c", fontWeight: "800" },
  tabBar: {
    height: 66,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#dfe4ea",
    flexDirection: "row",
    paddingBottom: Platform.OS === "ios" ? 6 : 0,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 13, fontWeight: "700", color: "#7b8798" },
  tabActive: { color: "#3156a3" },
});
