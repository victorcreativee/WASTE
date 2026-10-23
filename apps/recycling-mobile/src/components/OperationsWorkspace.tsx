import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileProblemCenter } from "./MobileProblemCenter";
import { mobileRequest } from "../lib/mobile-api";
import { AccountWorkspace } from "./AccountWorkspace";
import { useBottomNavigationSpace, RoleBottomNavigation } from "./RoleBottomNavigation";
import { AppHeader, Banner, Button, Card, Chips, EmptyState, Icon, Input, SectionHeader, StatusBadge, SummaryCard, page } from "../ui/kit";
import { color, radius, space, type } from "../ui/theme";

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
const label = (value: string) => { const words = value.replaceAll("_", " "); return words.charAt(0).toUpperCase() + words.slice(1); };

/**
 * A fresh GPS fix when one arrives within a few seconds, otherwise the phone's last known position.
 * Waiting indefinitely for satellites would leave the driver stuck at the stop.
 */
async function currentLocation(): Promise<Location.LocationObject | null> {
  const permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (permission?.status !== "granted") return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    timeout,
  ]);
  return fresh ?? Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
}

export function OperationsWorkspace({
  token,
  user,
  onLogout,
}: {
  token: string;
  user: User;
  onLogout: () => Promise<void>;
}) {
  const navSpace = useBottomNavigationSpace();
  const scrollRef = useRef<ScrollView>(null);
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
  // A new screen starts at the top rather than at the previous screen's scroll position.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [screen]);
  // Messages appear at the top of the screen, so bring them into view when a save fails further down.
  useEffect(() => {
    if (error) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [error]);

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
      if (result.queuedOffline) {
        if (path.endsWith("/start")) setRoute((current) => (current ? { ...current, status: "in_progress" } : current));
      } else void load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the update",
      );
    } finally {
      setSaving("");
    }
  }
  async function collect(customer: Customer, status: "complete" | "skip") {
    try {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark arrival at this stop");
      return;
    }
    if (status === "complete") {
      const location = await currentLocation();
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
      <View style={page.center}>
        <ActivityIndicator size="large" color={color.action} />
        <Text style={type.small}>Preparing your workspace…</Text>
      </View>
    );
  const stopsLeft = customers.length - resolved;
  return (
    <SafeAreaView style={page.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <AppHeader name={user.fullName} organization={driver ? "Driver" : "Supervisor"} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[page.content, { paddingBottom: navSpace }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        {error ? <Banner tone="danger" text={error} /> : null}
        {screen === "account" ? (
          <AccountWorkspace user={user} onLogout={onLogout} />
        ) : <>
        {driver ? (
          <>
            <SummaryCard label={route ? route.name : "Today"} value={route ? `${resolved} of ${customers.length} stops` : "No route yet"}
              caption={route ? `${new Date(route.route_date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} · ${route.plate_number || "Vehicle pending"}` : "Your dispatched route will appear here"}
              stats={[
                { label: "Collected", value: dashboard?.summary.collected_households || 0 },
                { label: "Not collected", value: dashboard?.summary.not_collected_households || 0 },
                { label: "Trips today", value: dashboard?.summary.trips_today || 0 },
              ]} />
            {!route ? (
              <EmptyState icon="navigate-outline" title="No route assigned" text="When your company dispatches a route to you, it appears here. Pull down to refresh." />
            ) : (
              <>
                {route.status === "dispatched" ? (
                  <Card>
                    <Text style={type.heading}>Ready to start</Text>
                    <Text style={type.small}>Start the route when you leave the depot. Stops then unlock in order.</Text>
                    <Button disabled={!!saving} loading={saving === `/api/waste/driver-routes/${route.id}/start`} icon="play-circle-outline" title="Start route" onPress={() => void mutate(`/api/waste/driver-routes/${route.id}/start`)} />
                  </Card>
                ) : null}
                <SectionHeader title={stopsLeft ? `Stops · ${stopsLeft} left` : "Stops · all done"} />
                {customers
                  .sort((a, b) => a.stop_order - b.stop_order)
                  .map((customer, index) => {
                    const open = !["completed", "skipped", "cancelled"].includes(customer.status);
                    const done = customer.status === "completed";
                    return (
                      <Card key={customer.id} style={!open ? { opacity: 0.75 } : undefined}>
                        <View style={s.stopTop}>
                          <View style={[s.number, done ? s.numberDone : !open ? s.numberSkipped : null]}>
                            {done ? <Icon name="checkmark" size={16} tint="#ffffff" /> : <Text style={[s.numberText, !open && { color: "#ffffff" }]}>{index + 1}</Text>}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={type.heading} numberOfLines={1}>{customer.customer_name}</Text>
                            <Text style={type.small} numberOfLines={2}>{customer.address}</Text>
                          </View>
                          <StatusBadge label={label(customer.status)} tone={done ? "success" : !open ? "warning" : customer.status === "in_progress" ? "action" : "neutral"} />
                        </View>
                        {open && route.status === "in_progress" ? (
                          <View style={page.columns}>
                            <Button title="Not collected" variant="secondary" disabled={!!saving} onPress={() => void collect(customer, "skip")} style={page.column} />
                            <Button title="Collected" icon="checkmark-circle-outline" disabled={!!saving} onPress={() => void collect(customer, "complete")} style={page.column} />
                          </View>
                        ) : null}
                      </Card>
                    );
                  })}
              </>
            )}
          </>
        ) : (
          <>
            <SummaryCard label="Company trips today" value={String(trips.length)}
              stats={[
                { label: "In progress", value: trips.filter((t) => t.status === "in_progress").length },
                { label: "Completed", value: trips.filter((t) => t.status === "completed").length },
                { label: "Not started", value: trips.filter((t) => ["not_started", "dispatched", "planned"].includes(t.status)).length },
              ]} />
            <Input accessibilityLabel="Search company trips" value={tripQuery} onChangeText={(value) => { setTripQuery(value); setTripPage(1); }} placeholder="Search route, driver, vehicle or area" />
            <Chips value={tripStatus} onChange={(value) => { setTripStatus(value); setTripPage(1); }}
              options={["all", "dispatched", "in_progress", "completed"].map((value) => ({ value, label: label(value) }))} />
            <SectionHeader title={`${filteredTrips.length} trip${filteredTrips.length === 1 ? "" : "s"}`} />
            {visibleTrips.map((trip) => {
              const done = trip.collected_count + trip.not_collected_count;
              const share = trip.customer_count ? Math.round((done / trip.customer_count) * 100) : 0;
              return (
                <Card key={trip.id}>
                  <View style={s.stopTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={type.heading} numberOfLines={1}>{trip.route_name}</Text>
                      <Text style={type.small} numberOfLines={1}>{trip.driver_name || "Driver pending"} · {trip.plate_number || "Vehicle pending"}</Text>
                    </View>
                    <StatusBadge label={label(trip.status)} tone={trip.status === "completed" ? "success" : trip.status === "in_progress" ? "action" : "neutral"} />
                  </View>
                  <View style={s.track}><View style={[s.trackFill, { width: `${share}%` }]} /></View>
                  <Text style={type.caption}>{done} of {trip.customer_count} customers · {trip.collected_count} collected · {trip.division_name}, {trip.zone_name}</Text>
                </Card>
              );
            })}
            {!filteredTrips.length ? (
              <EmptyState icon="bus-outline" title={trips.length ? "No matching trips" : "No trips today"}
                text={trips.length ? "Change the search or status filter." : "Trips appear after your company dispatches a route."} />
            ) : null}
            {filteredTrips.length > tripPageSize ? (
              <View style={s.pagination}>
                <Button title="Previous" variant="secondary" disabled={tripPage === 1} onPress={() => setTripPage((n) => Math.max(1, n - 1))} style={{ flex: 1 }} />
                <Text style={type.small}>{tripPage} / {tripPages}</Text>
                <Button title="Next" variant="secondary" disabled={tripPage === tripPages} onPress={() => setTripPage((n) => Math.min(tripPages, n + 1))} style={{ flex: 1 }} />
              </View>
            ) : null}
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
        { id: "dashboard", label: driver ? "Route" : "Trips", icon: driver ? "navigate-outline" : "bus-outline", active: screen === "work", onPress: () => setScreen("work") },
        { id: "account", label: "Account", icon: "person-outline", active: screen === "account", onPress: () => setScreen("account") },
      ]} />
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  stopTop: { flexDirection: "row", alignItems: "center", gap: space.md },
  number: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.actionSoft, alignItems: "center", justifyContent: "center" },
  numberDone: { backgroundColor: color.success },
  numberSkipped: { backgroundColor: color.warning },
  numberText: { color: color.action, fontWeight: "700", fontSize: 14 },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: color.fill, overflow: "hidden" },
  trackFill: { height: "100%", backgroundColor: color.action, borderRadius: radius.pill },
  pagination: { flexDirection: "row", alignItems: "center", gap: space.md },
});
