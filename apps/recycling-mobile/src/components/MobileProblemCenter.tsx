import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SupervisorTripInspector } from "./SupervisorTripInspector";
import { mobileRequest } from "../lib/mobile-api";

type Problem = {
  id: string;
  category: string;
  description: string;
  status: string;
  driver_name: string;
  zone_name: string | null;
  plate_number: string | null;
  created_at: string;
  resolution_notes: string | null;
};
type Trip = {
  id: string;
  trip_number: string;
  route_name: string;
  status: string;
  customer_count: number;
};
type Job = { id: string; label: string };
type Api<T> = { data: T; message: string };
const categories = [
  "blocked_access",
  "truck_problem",
  "unsafe_site",
  "waste_mismatch",
  "other",
] as const;
async function request<T>(
  path: string,
  token: string,
  owner: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return mobileRequest<T>(path, token, owner, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}
const title = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function MobileProblemCenter({
  token,
  ownerEmail,
  driver,
  jobs,
  routeId,
  routeActive,
}: {
  token: string;
  ownerEmail: string;
  driver: boolean;
  jobs: Job[];
  routeId?: string;
  routeActive: boolean;
}) {
  const [problems, setProblems] = useState<Problem[]>([]),
    [trips, setTrips] = useState<Trip[]>([]),
    [jobId, setJobId] = useState(""),
    [category, setCategory] =
      useState<(typeof categories)[number]>("blocked_access"),
    [description, setDescription] = useState(""),
    [showForm, setShowForm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setProblems(
        (
          await request<Api<Problem[]>>(
            "/api/waste/driver-job-problems",
            token,
            ownerEmail,
          )
        ).data,
      );
      if (!driver)
        setTrips(
          (await request<Api<Trip[]>>("/api/waste/trips", token, ownerEmail))
            .data,
        );
    } catch (c) {
      setError(c instanceof Error ? c.message : "Could not load field issues");
    }
  }, [driver, ownerEmail, token]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const selectedJobId = jobId || jobs[0]?.id || "";
  async function shareLocation() {
    if (!routeId) return;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted")
      return Alert.alert(
        "Location permission needed",
        "Enable location access so dispatch can see the vehicle position.",
      );
    try {
      setBusy(true);
      setError("");
      const point = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const result = await request<{ queuedOffline?: boolean }>(
        "/api/waste/fleet/live/location",
        token,
        ownerEmail,
        "POST",
        {
          routeId,
          latitude: point.coords.latitude,
          longitude: point.coords.longitude,
          accuracyM: point.coords.accuracy ?? undefined,
          speedKph:
            point.coords.speed == null
              ? undefined
              : Math.max(0, point.coords.speed * 3.6),
          headingDegrees:
            point.coords.heading == null || point.coords.heading < 0
              ? undefined
              : point.coords.heading,
          recordedAt: new Date(point.timestamp).toISOString(),
        },
      );
      Alert.alert(
        result.queuedOffline ? "Location saved offline" : "Location shared",
        result.queuedOffline
          ? "The location will be shared when internet returns."
          : "Dispatch received the vehicle’s current position.",
      );
    } catch (c) {
      setError(c instanceof Error ? c.message : "Could not share location");
    } finally {
      setBusy(false);
    }
  }
  async function report() {
    if (!selectedJobId || description.trim().length < 5)
      return setError(
        "Choose the affected stop and describe the problem in at least 5 characters.",
      );
    try {
      setBusy(true);
      setError("");
      const result = await request<{ queuedOffline?: boolean }>(
        `/api/waste/driver-jobs/${selectedJobId}/problems`,
        token,
        ownerEmail,
        "POST",
        { category, description: description.trim() },
      );
      setDescription("");
      setShowForm(false);
      if (!result.queuedOffline) void load();
      Alert.alert(
        result.queuedOffline ? "Problem saved offline" : "Problem reported",
        result.queuedOffline
          ? "This report will synchronize when internet returns."
          : "Your supervisor can now see and manage this issue.",
      );
    } catch (c) {
      setError(c instanceof Error ? c.message : "Could not report the problem");
    } finally {
      setBusy(false);
    }
  }
  async function update(id: string, status: "acknowledged" | "resolved") {
    try {
      setBusy(true);
      setError("");
      const result = await request<{ queuedOffline?: boolean }>(
        `/api/waste/driver-job-problems/${id}`,
        token,
        ownerEmail,
        "PATCH",
        {
          status,
          resolutionNotes:
            status === "resolved"
              ? "Resolved from supervisor mobile workspace"
              : undefined,
        },
      );
      setProblems((current) =>
        current.map((problem) =>
          problem.id === id ? { ...problem, status } : problem,
        ),
      );
      if (!result.queuedOffline) void load();
    } catch (c) {
      setError(c instanceof Error ? c.message : "Could not update the issue");
    } finally {
      setBusy(false);
    }
  }
  const visible = driver
    ? problems.slice(0, 5)
    : problems.filter((x) => x.status !== "resolved");
  return (
    <View style={s.wrap}>
      <View style={s.heading}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>
            {driver ? "Field support" : "Field issues"}
          </Text>
          <Text style={s.sub}>
            {driver
              ? "Keep dispatch informed without leaving your route."
              : "Acknowledge and resolve reports from your drivers."}
          </Text>
        </View>
        {driver && routeActive ? (
          <Pressable
            disabled={busy}
            onPress={() => void shareLocation()}
            style={s.outline}
          >
            <Text style={s.outlineText}>Share GPS</Text>
          </Pressable>
        ) : null}
      </View>
      <SupervisorTripInspector
        token={token}
        ownerEmail={ownerEmail}
        trips={trips}
        enabled={!driver}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
      {driver && routeActive ? (
        <Pressable
          onPress={() => setShowForm((x) => !x)}
          style={s.problemButton}
        >
          <Text style={s.problemButtonText}>
            {showForm ? "Close report form" : "Report a route problem"}
          </Text>
        </Pressable>
      ) : null}
      {driver && showForm ? (
        <View style={s.form}>
          <Text style={s.label}>Affected stop</Text>
          <View style={s.chips}>
            {jobs.map((job) => (
              <Pressable
                key={job.id}
                onPress={() => setJobId(job.id)}
                style={[s.chip, selectedJobId === job.id && s.chipActive]}
              >
                <Text
                  style={[
                    s.chipText,
                    selectedJobId === job.id && s.chipTextActive,
                  ]}
                >
                  {job.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>Problem type</Text>
          <View style={s.chips}>
            {categories.map((value) => (
              <Pressable
                key={value}
                onPress={() => setCategory(value)}
                style={[s.chip, category === value && s.chipActive]}
              >
                <Text
                  style={[s.chipText, category === value && s.chipTextActive]}
                >
                  {title(value)}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="Explain what happened and what support is needed"
            placeholderTextColor="#85948c"
            style={s.input}
          />
          <Pressable
            disabled={busy}
            onPress={() => void report()}
            style={s.primary}
          >
            <Text style={s.primaryText}>
              {busy ? "Sending…" : "Send report to supervisor"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {visible.map((problem) => (
        <View key={problem.id} style={s.card}>
          <View style={s.row}>
            <Text style={s.category}>{title(problem.category)}</Text>
            <Text style={[s.status, problem.status === "open" && s.open]}>
              {title(problem.status)}
            </Text>
          </View>
          <Text style={s.description}>{problem.description}</Text>
          <Text style={s.meta}>
            {driver
              ? `${problem.zone_name || "Route stop"} · ${new Date(problem.created_at).toLocaleString("en-GB")}`
              : `${problem.driver_name} · ${problem.plate_number || "Vehicle not shown"} · ${problem.zone_name || "Route stop"}`}
          </Text>
          {!driver ? (
            <View style={s.actions}>
              {problem.status === "open" ? (
                <Pressable
                  disabled={busy}
                  onPress={() => void update(problem.id, "acknowledged")}
                  style={s.outline}
                >
                  <Text style={s.outlineText}>Acknowledge</Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={busy}
                onPress={() => void update(problem.id, "resolved")}
                style={s.resolve}
              >
                <Text style={s.resolveText}>Mark resolved</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      {!visible.length ? (
        <Text style={s.empty}>
          {driver
            ? "No problems reported on your current work."
            : "No open driver issues require attention."}
        </Text>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  wrap: {
    marginTop: 30,
    borderTopWidth: 1,
    borderTopColor: "#cdd6d1",
    paddingTop: 20,
  },
  heading: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: "600", color: "#13201a" },
  sub: { fontSize: 13, lineHeight: 18, color: "#64736b", marginTop: 3 },
  error: {
    backgroundColor: "#fff1f2",
    borderLeftWidth: 3,
    borderLeftColor: "#dc2626",
    color: "#991b1b",
    padding: 11,
    marginBottom: 10,
  },
  outline: {
    borderWidth: 1,
    borderColor: "#2f7d5a",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  outlineText: { color: "#2f7d5a", fontSize: 12, fontWeight: "600" },
  problemButton: {
    backgroundColor: "#fff7df",
    borderLeftWidth: 4,
    borderLeftColor: "#d97706",
    padding: 14,
    marginBottom: 12,
  },
  problemButtonText: { color: "#92400e", fontWeight: "600" },
  form: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e7e3",
    padding: 15,
    marginBottom: 14,
  },
  label: { fontSize: 12, fontWeight: "600", color: "#34433b", marginBottom: 7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 13 },
  chip: {
    borderWidth: 1,
    borderColor: "#cdd6d1",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: "#e8f3ec", borderColor: "#2f7d5a" },
  chipText: { fontSize: 11, fontWeight: "700", color: "#4a5a51" },
  chipTextActive: { color: "#1d4d37" },
  input: {
    minHeight: 90,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#cdd6d1",
    padding: 12,
    fontSize: 14,
    color: "#13201a",
  },
  primary: {
    backgroundColor: "#2f7d5a",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  primaryText: { color: "white", fontWeight: "600" },
  card: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e7e3",
    padding: 14,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  category: { fontSize: 14, fontWeight: "600", color: "#13201a" },
  status: {
    fontSize: 10,
    fontWeight: "600",
    color: "#2f7d5a",
    textTransform: "uppercase",
  },
  open: { color: "#b45309" },
  description: { fontSize: 14, lineHeight: 20, color: "#34433b", marginTop: 9 },
  meta: { fontSize: 11, lineHeight: 17, color: "#64736b", marginTop: 8 },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    justifyContent: "flex-end",
  },
  resolve: {
    backgroundColor: "#166534",
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  resolveText: { color: "white", fontSize: 12, fontWeight: "600" },
  empty: { paddingVertical: 18, textAlign: "center", color: "#64736b" },
});
