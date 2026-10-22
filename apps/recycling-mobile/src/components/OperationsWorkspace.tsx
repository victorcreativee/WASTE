import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MobileProblemCenter } from "./MobileProblemCenter";
import { mobileRequest } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { RoleBottomNavigation } from "./RoleBottomNavigation";

type User = { fullName: string; email: string; roles: string[] };
type Trip = {
  id: string;
  trip_number: string;
  route_date: string;
  status: string;
  route_name: string;
  zone_name: string;
  division_name: string;
  plate_number: string | null;
  driver_name: string | null;
  supervisor_name: string | null;
  customer_count: number;
  collected_count: number;
  not_collected_count: number;
};
type Route = {
  id: string;
  name: string;
  route_date: string;
  status: string;
  plate_number: string | null;
  stop_count: number;
  completed_stop_count: number;
};
type Customer = {
  id: string;
  status: string;
  stop_order: number;
  customer_name: string;
  address: string;
  collected_weight_kg: string | null;
  routeStopId?: string;
  routeStopStatus?: string;
};
type Stop = {
  id: string;
  job_id: string;
  status: string;
  stop_order: number;
  zone_name: string | null;
  customer_stops: Customer[];
};
type RouteDetails = Route & { stops: Stop[] };
type Dashboard = {
  summary: {
    trips_today: number;
    in_progress: number;
    completed_trips: number;
    total_households: number;
    collected_households: number;
    not_collected_households: number;
    open_problems: number;
    verified_weight_kg: string;
  };
};
type Api<T> = { data: T; message: string };

async function request<T>(
  path: string,
  token: string,
  owner: string,
  init: RequestInit = {},
): Promise<T> {
  return mobileRequest<T>(path, token, owner, init);
}
const label = (value: string) => value.replaceAll("_", " ");

export function OperationsWorkspace({
  token,
  user,
  onLogout,
}: {
  token: string;
  user: User;
  onLogout: () => Promise<void>;
}) {
  const driver = user.roles.includes("driver"),
    supervisor =
      user.roles.includes("supervisor") || user.roles.includes("company_admin");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [route, setRoute] = useState<RouteDetails | null>(null),
    [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [saving, setSaving] = useState(""),
    [error, setError] = useState("");
  const [tripQuery, setTripQuery] = useState("");
  const [tripStatus, setTripStatus] = useState("all");
  const [tripPage, setTripPage] = useState(1);
  const [screen, setScreen] = useState<"work" | "account">("work");
  const load = useCallback(async () => {
    try {
      setError("");
      if (driver) {
        const [d, r] = await Promise.all([
          request<Api<Dashboard>>(
            "/api/waste/driver/dashboard",
            token,
            user.email,
          ),
          request<Api<Route[]>>("/api/waste/driver/routes", token, user.email),
        ]);
        setDashboard(d.data);
        const active =
          r.data.find((item) =>
            ["dispatched", "in_progress"].includes(item.status),
          ) || r.data[0];
        setRoute(
          active
            ? (
                await request<Api<RouteDetails>>(
                  `/api/waste/driver-routes/${active.id}`,
                  token,
                  user.email,
                )
              ).data
            : null,
        );
      } else if (supervisor) {
        setTrips(
          (await request<Api<Trip[]>>("/api/waste/trips", token, user.email))
            .data,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load mobile operations",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [driver, supervisor, token, user.email]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function mutate(path: string, body?: Record<string, unknown>) {
    try {
      setSaving(path);
      setError("");
      const result = await request<{ queuedOffline?: boolean }>(
        path,
        token,
        user.email,
        { method: "PATCH", body: body ? JSON.stringify(body) : undefined },
      );
      if (!result.queuedOffline) await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the update",
      );
    } finally {
      setSaving("");
    }
  }
  async function collect(customer: Customer, status: "complete" | "skip") {
    if (
      customer.routeStopStatus !== "arrived" &&
      customer.routeStopStatus !== "completed"
    )
      await request(
        `/api/waste/driver-route-stops/${customer.routeStopId}/arrive`,
        token,
        user.email,
        { method: "PATCH" },
      );
    if (status === "complete") {
      const permission = await Location.requestForegroundPermissionsAsync();
      let location: Location.LocationObject | null = null;
      if (permission.status === "granted")
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }).catch(() => null);
      const gps = location
        ? `GPS: ${location.coords.latitude.toFixed(6)}, ${location.coords.longitude.toFixed(6)} · ±${Math.round(location.coords.accuracy || 0)} m`
        : "GPS not captured";
      setRoute((current) =>
        current
          ? {
              ...current,
              stops: current.stops.map((stop) => ({
                ...stop,
                customer_stops: stop.customer_stops.map((item) =>
                  item.id === customer.id
                    ? { ...item, status: "completed" }
                    : item,
                ),
              })),
            }
          : current,
      );
      await mutate(`/api/waste/customer-collection-stops/${customer.id}`, {
        action: "complete",
        notes: gps,
      });
    } else {
      Alert.alert(
        "Could not collect",
        `Confirm that collection was not completed for ${customer.customer_name}.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Confirm",
            style: "destructive",
            onPress: () => {
              setRoute((current) =>
                current
                  ? {
                      ...current,
                      stops: current.stops.map((stop) => ({
                        ...stop,
                        customer_stops: stop.customer_stops.map((item) =>
                          item.id === customer.id
                            ? { ...item, status: "skipped" }
                            : item,
                        ),
                      })),
                    }
                  : current,
              );
              void mutate(
                `/api/waste/customer-collection-stops/${customer.id}`,
                {
                  action: "skip",
                  exceptionReason: "customer_unavailable",
                  exceptionNotes: "Recorded from mobile operations",
                },
              );
            },
          },
        ],
      );
    }
  }
  const customers = useMemo(
    () =>
      route?.stops.flatMap((stop) =>
        (stop.customer_stops || []).map((customer) => ({
          ...customer,
          routeStopId: stop.id,
          routeStopStatus: stop.status,
        })),
      ) || [],
    [route],
  );
  const resolved = customers.filter((item) =>
    ["completed", "skipped", "cancelled"].includes(item.status),
  ).length;
  const filteredTrips = useMemo(() => {
    const query = tripQuery.trim().toLowerCase();
    return trips.filter((trip) => {
      const matchesStatus = tripStatus === "all" || trip.status === tripStatus;
      const matchesQuery = !query || [trip.route_name, trip.driver_name, trip.plate_number, trip.zone_name, trip.division_name]
        .some((value) => String(value || "").toLowerCase().includes(query));
      return matchesStatus && matchesQuery;
    });
  }, [tripQuery, tripStatus, trips]);
  const tripPageSize = 10;
  const tripPages = Math.max(1, Math.ceil(filteredTrips.length / tripPageSize));
  const visibleTrips = filteredTrips.slice((tripPage - 1) * tripPageSize, tripPage * tripPageSize);
  if (loading)
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3156a3" />
        <Text style={s.muted}>Preparing your workspace…</Text>
      </View>
    );
  return (
    <View style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>KAMPALA WASTE MANAGEMENT</Text>
          <Text style={s.headerTitle}>
            {driver ? "Driver workspace" : "Supervisor workspace"}
          </Text>
        </View>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {screen === "account" ? (
          <AccountWorkspace user={user} onLogout={onLogout} />
        ) : <>
        <Text style={s.title}>Good day, {user.fullName.split(" ")[0]}</Text>
        <Text style={s.roleLabel}>{driver ? "Driver" : user.roles.map((role) => role.replaceAll("_", " ")).join(" · ")}</Text>
        <Text style={s.subtitle}>
          {driver
            ? "Complete your assigned route in order and record every customer outcome."
            : "Monitor today’s company trips, teams and collection progress."}
        </Text>
        {driver ? (
          <>
            <View style={s.metrics}>
              <Metric
                label="TRIPS TODAY"
                value={dashboard?.summary.trips_today || 0}
              />
              <Metric
                label="COLLECTED"
                value={dashboard?.summary.collected_households || 0}
              />
              <Metric
                label="NOT COLLECTED"
                value={dashboard?.summary.not_collected_households || 0}
              />
            </View>
            {!route ? (
              <Empty
                title="No route assigned"
                text="A dispatched route from your company will appear here."
              />
            ) : (
              <>
                <View style={s.routeHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.routeName}>{route.name}</Text>
                    <Text style={s.muted}>
                      {new Date(route.route_date).toLocaleDateString("en-GB")} ·{" "}
                      {route.plate_number || "Vehicle pending"}
                    </Text>
                  </View>
                  <Status value={route.status} />
                </View>
                <Text style={s.progress}>
                  {resolved} of {customers.length} customer outcomes recorded
                </Text>
                {route.status === "dispatched" ? (
                  <Action
                    disabled={!!saving}
                    label="Start assigned route"
                    onPress={() =>
                      void mutate(`/api/waste/driver-routes/${route.id}/start`)
                    }
                  />
                ) : null}
                {customers
                  .sort((a, b) => a.stop_order - b.stop_order)
                  .map((customer, index) => (
                    <View key={customer.id} style={s.card}>
                      <View style={s.number}>
                        <Text style={s.numberText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cardTitle}>
                          {customer.customer_name}
                        </Text>
                        <Text style={s.muted}>{customer.address}</Text>
                        <Status value={customer.status} />
                        {!["completed", "skipped", "cancelled"].includes(
                          customer.status,
                        ) && route.status === "in_progress" ? (
                          <View style={s.actions}>
                            <Pressable
                              disabled={!!saving}
                              onPress={() => void collect(customer, "complete")}
                              style={s.smallPrimary}
                            >
                              <Text style={s.smallPrimaryText}>
                                Confirm collected
                              </Text>
                            </Pressable>
                            <Pressable
                              disabled={!!saving}
                              onPress={() => void collect(customer, "skip")}
                              style={s.smallSecondary}
                            >
                              <Text style={s.smallSecondaryText}>
                                Could not collect
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))}
              </>
            )}
          </>
        ) : (
          <>
            <View style={s.metrics}>
              <Metric label="TRIPS" value={trips.length} />
              <Metric
                label="IN PROGRESS"
                value={trips.filter((t) => t.status === "in_progress").length}
              />
              <Metric
                label="COMPLETED"
                value={trips.filter((t) => t.status === "completed").length}
              />
            </View>
            <Text style={s.section}>Today’s company trips</Text>
            <TextInput
              accessibilityLabel="Search company trips"
              value={tripQuery}
              onChangeText={(value) => { setTripQuery(value); setTripPage(1); }}
              placeholder="Search route, driver, vehicle or area"
              placeholderTextColor="#8390a5"
              style={s.input}
            />
            <View style={s.filters}>
              {["all", "not_started", "dispatched", "in_progress", "completed"].map((status) => (
                <Pressable key={status} onPress={() => { setTripStatus(status); setTripPage(1); }} style={[s.filter, tripStatus === status && s.filterActive]}>
                  <Text style={[s.filterText, tripStatus === status && s.filterTextActive]}>{label(status)}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.resultCount}>{filteredTrips.length} matching trip{filteredTrips.length === 1 ? "" : "s"}</Text>
            {visibleTrips.map((trip) => {
              const done = trip.collected_count + trip.not_collected_count;
              return (
                <View key={trip.id} style={s.cardColumn}>
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle}>{trip.route_name}</Text>
                      <Text style={s.muted}>
                        {trip.division_name} · {trip.zone_name}
                      </Text>
                    </View>
                    <Status value={trip.status} />
                  </View>
                  <Text style={s.team}>
                    {trip.driver_name || "Driver pending"} ·{" "}
                    {trip.plate_number || "Vehicle pending"}
                  </Text>
                  <Text style={s.progress}>
                    {done} / {trip.customer_count} customers ·{" "}
                    {trip.collected_count} collected
                  </Text>
                </View>
              );
            })}
            {!filteredTrips.length ? (
              <Empty
                title={trips.length ? "No matching trips" : "No trips today"}
                text={trips.length ? "Change the search or status filter." : "Trips appear after your company dispatches a route."}
              />
            ) : null}
            {filteredTrips.length > tripPageSize ? <View style={s.pagination}>
              <Pressable disabled={tripPage === 1} onPress={() => setTripPage((page) => Math.max(1, page - 1))} style={[s.pageButton, tripPage === 1 && s.disabled]}><Text style={s.pageButtonText}>Previous</Text></Pressable>
              <Text style={s.pageLabel}>Page {tripPage} of {tripPages}</Text>
              <Pressable disabled={tripPage === tripPages} onPress={() => setTripPage((page) => Math.min(tripPages, page + 1))} style={[s.pageButton, tripPage === tripPages && s.disabled]}><Text style={s.pageButtonText}>Next</Text></Pressable>
            </View> : null}
          </>
        )}
        <MobileProblemCenter
          token={token}
          ownerEmail={user.email}
          driver={driver}
          jobs={
            route?.stops.map((stop) => ({
              id: stop.job_id,
              label: stop.zone_name || `Stop ${stop.stop_order}`,
            })) || []
          }
          routeId={route?.id}
          routeActive={route?.status === "in_progress"}
        />
        </>}
      </ScrollView>
      <RoleBottomNavigation items={[
        { id: "dashboard", label: "Dashboard", icon: "⌂", active: screen === "work", onPress: () => setScreen("work") },
        { id: "account", label: "Account", icon: "●", active: screen === "account", onPress: () => setScreen("account") },
      ]} />
    </View>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Text
      style={[
        s.status,
        ["completed", "active"].includes(value) && s.statusGood,
        value === "in_progress" && s.statusBlue,
      ]}
    >
      {label(value)}
    </Text>
  );
}
function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[s.primary, disabled && { opacity: 0.5 }]}
    >
      <Text style={s.primaryText}>{label}</Text>
    </Pressable>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.muted}>{text}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f7f5" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  header: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#dfe4ea",
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "#3156a3",
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#111827",
    marginTop: 4,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  logout: { fontWeight: "800", color: "#3156a3" },
  page: { padding: 20, paddingBottom: 110 },
  bottomNav: { minHeight: 66, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#d8dfeb", flexDirection: "row", paddingHorizontal: 12, paddingBottom: 4 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", borderTopWidth: 3, borderTopColor: "transparent" },
  navItemActive: { borderTopColor: "#3156a3", backgroundColor: "#f5f8ff" },
  navText: { color: "#64748b", fontWeight: "700" },
  navTextActive: { color: "#3156a3" },
  title: { fontSize: 29, fontWeight: "800", color: "#111827" },
  roleLabel: { alignSelf: "flex-start", color: "#3156a3", backgroundColor: "#eaf0fc", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 9, fontSize: 11, fontWeight: "900", textTransform: "capitalize", overflow: "hidden" },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#64748b",
    marginTop: 7,
    marginBottom: 20,
  },
  muted: { fontSize: 13, lineHeight: 19, color: "#64748b", marginTop: 3 },
  error: {
    backgroundColor: "#fff1f2",
    borderLeftWidth: 4,
    borderLeftColor: "#dc2626",
    color: "#991b1b",
    fontWeight: "700",
    padding: 13,
    margin: 16,
  },
  metrics: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#d8dee8",
    marginBottom: 22,
  },
  metric: {
    flex: 1,
    padding: 12,
    borderRightWidth: 1,
    borderRightColor: "#d8dee8",
  },
  metricLabel: { fontSize: 9, fontWeight: "800", color: "#64748b" },
  metricValue: {
    fontSize: 25,
    fontWeight: "800",
    color: "#111827",
    marginTop: 5,
  },
  routeHead: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 16,
  },
  routeName: { fontSize: 23, fontWeight: "800", color: "#111827" },
  progress: {
    fontSize: 13,
    fontWeight: "700",
    color: "#3156a3",
    marginVertical: 13,
  },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3156a3",
    marginBottom: 18,
  },
  primaryText: { color: "white", fontWeight: "800", fontSize: 15 },
  card: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#dfe4ea",
    padding: 15,
    marginBottom: 12,
    flexDirection: "row",
    gap: 12,
  },
  cardColumn: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#dfe4ea",
    padding: 16,
    marginBottom: 12,
  },
  number: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#e8eefb",
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { fontWeight: "800", color: "#3156a3" },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  status: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#f1f5f9",
    color: "#475569",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  statusGood: { backgroundColor: "#ecfdf5", color: "#047857" },
  statusBlue: { backgroundColor: "#eff6ff", color: "#1d4ed8" },
  actions: { flexDirection: "row", gap: 8, marginTop: 13, flexWrap: "wrap" },
  smallPrimary: {
    backgroundColor: "#3156a3",
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  smallPrimaryText: { color: "white", fontWeight: "800", fontSize: 12 },
  smallSecondary: {
    borderWidth: 1,
    borderColor: "#d97706",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  smallSecondaryText: { color: "#92400e", fontWeight: "800", fontSize: 12 },
  section: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 13,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  team: { fontSize: 13, fontWeight: "700", color: "#334155", marginTop: 12 },
  input: { minHeight: 50, borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "white", paddingHorizontal: 14, fontSize: 15, color: "#111827", marginBottom: 10 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  filter: { borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "white", paddingHorizontal: 11, paddingVertical: 8 },
  filterActive: { borderColor: "#3156a3", backgroundColor: "#eaf0fc" },
  filterText: { color: "#475569", fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  filterTextActive: { color: "#24498f" },
  resultCount: { color: "#64748b", fontSize: 12, fontWeight: "700", marginBottom: 12 },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 },
  pageButton: { borderWidth: 1, borderColor: "#3156a3", paddingHorizontal: 14, paddingVertical: 10 },
  pageButtonText: { color: "#3156a3", fontWeight: "800", fontSize: 12 },
  pageLabel: { color: "#475569", fontWeight: "700", fontSize: 12 },
  disabled: { opacity: 0.4 },
  empty: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 24,
  },
});
