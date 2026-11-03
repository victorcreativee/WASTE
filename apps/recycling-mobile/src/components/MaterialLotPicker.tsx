import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, space, type, ugx } from "../ui/theme";

export type MaterialLotOption = {
  id?: unknown;
  material_type?: unknown;
  materialType?: unknown;
  source_name?: unknown;
  sourceName?: unknown;
  quantity_kg?: unknown;
  available_kg?: unknown;
  unit_purchase_price_ugx?: unknown;
  quality?: unknown;
  origin?: unknown;
  collected_on?: unknown;
};

const value = (input: unknown, fallback = "—") => typeof input === "string" && input.trim() ? input : fallback;
const number = (input: unknown) => Number(input || 0);

export function MaterialLotPicker({ lots, selectedId, onSelect, onlyAvailable = true }: {
  lots: MaterialLotOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onlyAvailable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | "purchase" | "sorting_output">("all");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lots.filter((lot) => {
      const available = number(lot.available_kg ?? lot.quantity_kg);
      const matchesSource = source === "all" || value(lot.origin, "purchase") === source;
      const searchable = `${value(lot.material_type ?? lot.materialType, "")} ${value(lot.source_name ?? lot.sourceName, "")} ${value(lot.quality, "")}`.toLowerCase();
      return (!onlyAvailable || available > 0) && matchesSource && (!needle || searchable.includes(needle));
    });
  }, [lots, onlyAvailable, query, source]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return <View style={styles.wrap}>
    <TextInput accessibilityLabel="Search material lots" value={query} onChangeText={(next) => { setQuery(next); setPage(1); }} placeholder="Search material, supplier or quality" placeholderTextColor={color.muted} style={styles.search} />
    <View style={styles.filters}>
      {([['all', 'All'], ['purchase', 'Purchased'], ['sorting_output', 'Processed']] as const).map(([id, label]) =>
        <Pressable key={id} onPress={() => { setSource(id); setPage(1); }} style={[styles.filter, source === id && styles.filterActive]}>
          <Text style={[styles.filterText, source === id && styles.filterTextActive]}>{label}</Text>
        </Pressable>)}
    </View>
    <View style={styles.list}>
      {visible.map((lot, index) => {
        const id = String(lot.id ?? index);
        const original = number(lot.quantity_kg);
        const available = number(lot.available_kg ?? lot.quantity_kg);
        const remaining = original > 0 ? Math.max(0, Math.min(100, available / original * 100)) : 0;
        const selected = selectedId === id;
        return <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onSelect(id)} style={[styles.lot, selected && styles.lotSelected]}>
          <View style={styles.lotHead}>
            <View style={{ flex: 1 }}><Text style={[styles.material, selected && styles.materialSelected]} numberOfLines={1}>{value(lot.material_type ?? lot.materialType, "Material")}</Text><Text style={styles.meta} numberOfLines={1}>{value(lot.source_name ?? lot.sourceName, lot.origin === "sorting_output" ? "Processing output" : "Supplier not recorded")} · {value(lot.quality, "Unspecified quality")}</Text></View>
            <View style={styles.quantity}><Text style={[styles.quantityValue, selected && styles.materialSelected]}>{available.toLocaleString("en-GB")} kg</Text><Text style={styles.meta}>available</Text></View>
          </View>
          <View style={styles.progress}><View style={[styles.progressFill, { width: `${remaining}%` }]} /></View>
          <View style={styles.foot}><Text style={styles.meta}>{original.toLocaleString("en-GB")} kg received</Text>{number(lot.unit_purchase_price_ugx) > 0 ? <Text style={styles.meta}>{ugx(number(lot.unit_purchase_price_ugx))}/kg</Text> : null}</View>
        </Pressable>;
      })}
      {!visible.length ? <View style={styles.empty}><Text style={type.heading}>No matching material lot</Text><Text style={type.small}>Try another search or source filter.</Text></View> : null}
    </View>
    {filtered.length > pageSize ? <View style={styles.pagination}>
      <Pressable disabled={safePage === 1} onPress={() => setPage((current) => Math.max(1, current - 1))} style={[styles.pageButton, safePage === 1 && styles.disabled]}><Text style={styles.pageText}>Previous</Text></Pressable>
      <Text style={type.small}>{safePage} / {pages}</Text>
      <Pressable disabled={safePage === pages} onPress={() => setPage((current) => Math.min(pages, current + 1))} style={[styles.pageButton, safePage === pages && styles.disabled]}><Text style={styles.pageText}>Next</Text></Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm }, search: { minHeight: 48, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, borderRadius: radius.md, paddingHorizontal: space.md, color: color.ink, fontSize: 15 },
  filters: { flexDirection: "row", gap: 7 }, filter: { minHeight: 36, justifyContent: "center", paddingHorizontal: 13, borderRadius: 999, backgroundColor: color.fill }, filterActive: { backgroundColor: color.actionSoft }, filterText: { color: color.muted, fontSize: 12, fontWeight: "600" }, filterTextActive: { color: color.actionInk },
  list: { borderWidth: 1, borderColor: color.line, borderRadius: radius.md, overflow: "hidden" }, lot: { padding: 13, gap: 9, backgroundColor: color.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line }, lotSelected: { backgroundColor: color.actionSoft, borderLeftWidth: 3, borderLeftColor: color.action },
  lotHead: { flexDirection: "row", alignItems: "center", gap: 12 }, material: { color: color.ink, fontSize: 15, fontWeight: "700" }, materialSelected: { color: color.actionInk }, meta: { color: color.muted, fontSize: 11, marginTop: 2 }, quantity: { alignItems: "flex-end" }, quantityValue: { color: color.ink, fontWeight: "700", fontSize: 14 },
  progress: { height: 4, borderRadius: 99, overflow: "hidden", backgroundColor: color.fill }, progressFill: { height: "100%", backgroundColor: color.action, borderRadius: 99 }, foot: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  empty: { padding: space.lg, gap: 4, alignItems: "center" }, pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, pageButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: color.line, borderRadius: radius.sm }, pageText: { color: color.action, fontWeight: "700", fontSize: 12 }, disabled: { opacity: .4 },
});
