import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { mobileRequest } from "../lib/mobile-api";
type Trip = {
  id: string;
  trip_number: string;
  route_name: string;
  status: string;
  customer_count: number;
};
type Customer = {
  id: string;
  status: string;
  stop_order: number;
  customer_name: string;
  address: string;
  exception_reason?: string | null;
  exception_notes?: string | null;
};
type Stop = { customer_stops: Customer[] };
type Detail = {
  id: string;
  name: string;
  status: string;
  plate_number: string | null;
  driver_name: string | null;
  route_date: string;
  stops: Stop[];
};
async function getDetail(id: string, token: string, ownerEmail: string) {
  return (
    await mobileRequest<{ data: Detail }>(
      `/api/waste/driver-routes/${id}`,
      token,
      ownerEmail,
    )
  ).data;
}
const display = (value: string) => value.replaceAll("_", " ");
export function SupervisorTripInspector({
  token,
  ownerEmail,
  trips,
  enabled,
}: {
  token: string;
  ownerEmail: string;
  trips: Trip[];
  enabled: boolean;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  if (!enabled || !trips.length) return null;
  async function open(id: string) {
    try {
      setSelected(id);
      setLoading(true);
      setError("");
      setDetail(await getDetail(id, token, ownerEmail));
    } catch (c) {
      setError(c instanceof Error ? c.message : "Could not open trip");
    } finally {
      setLoading(false);
    }
  }
  const customers =
      detail?.stops.flatMap((stop) => stop.customer_stops || []) || [],
    collected = customers.filter((x) => x.status === "completed").length,
    missed = customers.filter((x) => x.status === "skipped").length,
    pending = customers.length - collected - missed;
  return (
    <View style={s.wrap}>
      <Text style={s.title}>Trip details</Text>
      <Text style={s.sub}>
        Select a trip to review its team and every customer outcome.
      </Text>
      <View style={s.chips}>
        {trips.slice(0, 10).map((trip) => (
          <Pressable
            key={trip.id}
            onPress={() => void open(trip.id)}
            style={[s.chip, selected === trip.id && s.chipActive]}
          >
            <Text
              style={[s.chipText, selected === trip.id && s.chipTextActive]}
            >
              {trip.route_name}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator color="#2952cc" /> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      {detail && !loading ? (
        <>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.route}>{detail.name}</Text>
              <Text style={s.meta}>
                {detail.driver_name || "Driver pending"} ·{" "}
                {detail.plate_number || "Vehicle pending"}
              </Text>
            </View>
            <Text style={s.state}>{display(detail.status)}</Text>
          </View>
          <View style={s.metrics}>
            <Metric label="COLLECTED" value={collected} />
            <Metric label="NOT COLLECTED" value={missed} />
            <Metric label="PENDING" value={pending} />
          </View>
          {customers
            .sort((a, b) => a.stop_order - b.stop_order)
            .map((customer, index) => (
              <View key={customer.id} style={s.customer}>
                <View
                  style={[
                    s.number,
                    customer.status === "completed" && s.done,
                    customer.status === "skipped" && s.missed,
                  ]}
                >
                  <Text style={s.numberText}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.row}>
                    <Text style={s.name}>{customer.customer_name}</Text>
                    <Text style={s.customerState}>
                      {display(customer.status)}
                    </Text>
                  </View>
                  <Text style={s.meta}>{customer.address}</Text>
                  {customer.exception_reason ? (
                    <Text style={s.exception}>
                      {display(customer.exception_reason)}
                      {customer.exception_notes
                        ? ` · ${customer.exception_notes}`
                        : ""}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
        </>
      ) : null}
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
const s = StyleSheet.create({
  wrap: {
    marginTop: 26,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    paddingTop: 20,
  },
  title: { fontSize: 20, fontWeight: "600", color: "#0f172a" },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748b",
    marginTop: 3,
    marginBottom: 12,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: "white",
  },
  chipActive: { borderColor: "#2952cc", backgroundColor: "#eef2fd" },
  chipText: { fontSize: 12, fontWeight: "700", color: "#475569" },
  chipTextActive: { color: "#24498f" },
  error: {
    backgroundColor: "#fff1f2",
    color: "#991b1b",
    padding: 11,
    fontWeight: "700",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#d8dee8",
  },
  route: { fontSize: 18, fontWeight: "600", color: "#0f172a" },
  meta: { fontSize: 12, lineHeight: 18, color: "#64748b", marginTop: 3 },
  state: {
    fontSize: 11,
    fontWeight: "600",
    color: "#2952cc",
    textTransform: "uppercase",
  },
  metrics: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#d8dee8",
    marginVertical: 14,
  },
  metric: {
    flex: 1,
    padding: 11,
    borderRightWidth: 1,
    borderRightColor: "#d8dee8",
  },
  metricLabel: { fontSize: 8, fontWeight: "600", color: "#64748b" },
  metricValue: {
    fontSize: 22,
    fontWeight: "600",
    color: "#0f172a",
    marginTop: 4,
  },
  customer: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    padding: 14,
    flexDirection: "row",
    gap: 11,
  },
  number: {
    width: 31,
    height: 31,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  done: { backgroundColor: "#dcfce7" },
  missed: { backgroundColor: "#ffedd5" },
  numberText: { fontSize: 12, fontWeight: "600", color: "#334155" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 14, fontWeight: "600", color: "#0f172a", flex: 1 },
  customerState: {
    fontSize: 10,
    fontWeight: "600",
    color: "#2952cc",
    textTransform: "uppercase",
  },
  exception: { fontSize: 11, lineHeight: 17, color: "#9a3412", marginTop: 6 },
});
