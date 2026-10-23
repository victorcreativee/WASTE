import Ionicons from "@expo/vector-icons/Ionicons";
import { ComponentProps, ReactNode, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { Tone, color, initials, radius, shadow, space, tone, type, ugx } from "./theme";

// Shared building blocks for every workspace: one header, one summary card, quick actions, sections, list rows, segmented
// tabs, form fields and buttons. Screens compose these instead of styling their own versions.

export type IconName = ComponentProps<typeof Ionicons>["name"];
export function Icon({ name, size = 20, tint = color.text }: { name: IconName; size?: number; tint?: string }) {
  return <Ionicons name={name} size={size} color={tint} />;
}

/** Top of a workspace: initials, greeting and organization, with room for the sync status on the right. */
export function AppHeader({ name, organization, right }: { name: string; organization?: string; right?: ReactNode }) {
  const first = name.split(/\s+/)[0] || "there";
  return <View style={s.header}>
    <View style={s.avatar}><Text style={s.avatarText}>{initials(name)}</Text></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={s.headerHello} numberOfLines={1}>Hi, {first}</Text>
      {organization ? <Text style={s.headerOrg} numberOfLines={1}>{organization}</Text> : null}
    </View>
    {right}
  </View>;
}

/** Titled sub-screen bar with a back button. */
export function ScreenBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return <View style={s.screenBar}>
    {onBack ? <IconButton icon="chevron-back" label="Back" onPress={onBack} /> : <View style={s.iconButtonSpace} />}
    <Text style={s.screenBarTitle} numberOfLines={1}>{title}</Text>
    {right || <View style={s.iconButtonSpace} />}
  </View>;
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.iconButton, pressed && s.pressed]}>
    <Icon name={icon} size={20} tint={color.ink} />
  </Pressable>;
}

/** The one strong card on a dashboard: a headline figure with a few supporting figures. */
export function SummaryCard({ label, value, caption, stats = [] }: { label: string; value: string; caption?: string; stats?: { label: string; value: string | number }[] }) {
  return <View style={s.summary}>
    <Text style={s.summaryLabel}>{label}</Text>
    <Text style={s.summaryValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    {caption ? <Text style={s.summaryCaption}>{caption}</Text> : null}
    {stats.length ? <View style={s.summaryStats}>{stats.map((stat, index) => <View key={stat.label} style={[s.summaryStat, index > 0 && s.summaryStatBorder]}>
      <Text style={s.summaryStatValue} numberOfLines={1}>{stat.value}</Text>
      <Text style={s.summaryStatLabel} numberOfLines={1}>{stat.label}</Text>
    </View>)}</View> : null}
  </View>;
}

export type QuickAction = { icon: IconName; label: string; onPress: () => void; tone?: Tone; disabled?: boolean };
/** Grid of large tap targets for the most common jobs. */
export function QuickActions({ items }: { items: QuickAction[] }) {
  return <View style={s.quick}>{items.map(item => {
    const t = tone[item.tone ?? "action"];
    return <Pressable key={item.label} accessibilityRole="button" disabled={item.disabled} onPress={item.onPress}
      style={({ pressed }) => [s.quickTile, pressed && s.pressed, item.disabled && s.disabled]}>
      <View style={[s.quickIcon, { backgroundColor: t.soft }]}><Icon name={item.icon} size={22} tint={t.ink} /></View>
      <Text style={s.quickLabel} numberOfLines={2}>{item.label}</Text>
    </Pressable>;
  })}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return <View style={s.section}>
    <Text style={type.heading}>{title}</Text>
    {action ? <Pressable onPress={action.onPress} hitSlop={8}><Text style={s.sectionAction}>{action.label}</Text></Pressable> : null}
  </View>;
}

export function StatusBadge({ label, tone: t = "neutral" }: { label: string; tone?: Tone }) {
  return <Text style={[s.badge, { color: tone[t].ink, backgroundColor: tone[t].soft }]}>{label}</Text>;
}

/** Soft row: leading icon, title and details, and a value on the right. */
export function ListRow({ icon, iconTone = "neutral", title, subtitle, value, detail, badge, onPress, chevron }: {
  icon?: IconName; iconTone?: Tone; title: string; subtitle?: string; value?: string; detail?: string; badge?: { label: string; tone?: Tone }; onPress?: () => void; chevron?: boolean;
}) {
  const body = <>
    {icon ? <View style={[s.rowIcon, { backgroundColor: tone[iconTone].soft }]}><Icon name={icon} size={19} tint={tone[iconTone].ink} /></View> : null}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text style={s.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
    </View>
    {value || detail || badge ? <View style={s.rowEnd}>
      {value ? <Text style={s.rowValue} numberOfLines={1}>{value}</Text> : null}
      {detail ? <Text style={s.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
    </View> : null}
    {chevron ? <Icon name="chevron-forward" size={18} tint={color.subtle} /> : null}
  </>;
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.row, pressed && s.pressed]}>{body}</Pressable>
    : <View style={s.row}>{body}</View>;
}

/** Two to four mutually exclusive views on one screen. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <View style={s.segmented} accessibilityRole="tablist">{options.map(option => {
    const active = option.value === value;
    return <Pressable key={option.value} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(option.value)} style={[s.segment, active && s.segmentActive]}>
      <Text style={[s.segmentText, active && s.segmentTextActive]} numberOfLines={1}>{option.label}</Text>
    </Pressable>;
  })}</View>;
}

/** Choice chips for short option lists (materials, quality, payment). */
export function Chips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return <View style={s.chips}>{options.map(option => {
    const active = option.value === value;
    return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => onChange(option.value)} style={[s.chip, active && s.chipActive]}>
      {active ? <Icon name="checkmark" size={14} tint={color.action} /> : null}
      <Text style={[s.chipText, active && s.chipTextActive]}>{option.label}</Text>
    </Pressable>;
  })}</View>;
}

export function Field({ label, hint, error, children, style }: { label: string; hint?: string; error?: string; children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.field, style]}>
    <Text style={type.label}>{label}</Text>
    {children}
    {error ? <Text style={s.fieldError}>{error}</Text> : hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
  </View>;
}

/** Soft filled text input; the border appears only while typing. */
export function Input({ multiline, style, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return <TextInput placeholderTextColor={color.subtle} multiline={multiline} {...props}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }} onBlur={event => { setFocused(false); props.onBlur?.(event); }}
    style={[s.input, multiline && s.textarea, focused && s.inputFocused, style]} />;
}

/** Whole-shilling amount with its formatted value shown underneath, so a missing zero is obvious. */
export function MoneyInput({ value, onChangeText, placeholder = "0" }: { value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  const amount = Number(value || 0);
  return <View>
    <Input value={value} onChangeText={text => onChangeText(text.replace(/[^\d]/g, ""))} keyboardType="number-pad" placeholder={placeholder} />
    {amount > 0 ? <Text style={s.moneyEcho}>{ugx(amount)}</Text> : null}
  </View>;
}

/** Suggests a reference such as FLT-261023-4821 when the paper voucher has no number of its own. */
export function makeReference(prefix: string) {
  const d = new Date();
  const date = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${prefix}-${date}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Reference / voucher number: the number written on the receipt, voucher or mobile-money message that proves this money
 * moved. Typing it links the record to the paper; "Use a new number" fills in one to write on the voucher.
 */
export function ReferenceInput({ value, onChangeText, prefix, placeholder }: { value: string; onChangeText: (value: string) => void; prefix: string; placeholder?: string }) {
  return <View style={s.referenceRow}>
    <Input value={value} onChangeText={text => onChangeText(text.toUpperCase())} autoCapitalize="characters" placeholder={placeholder || `e.g. ${prefix}-001`} style={{ flex: 1 }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Use a new reference number" onPress={() => onChangeText(makeReference(prefix))} style={({ pressed }) => [s.referenceButton, pressed && s.pressed]}>
      <Icon name="sparkles-outline" size={16} tint={color.action} />
      <Text style={s.referenceButtonText}>New</Text>
    </Pressable>
  </View>;
}

export function Button({ title, onPress, variant = "primary", icon, disabled, loading, style }: {
  title: string; onPress: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconName; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const ink = variant === "primary" ? "#ffffff" : variant === "danger" ? color.danger : variant === "ghost" ? color.action : color.ink;
  return <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress}
    style={({ pressed }) => [s.button, s[`button_${variant}`], pressed && (variant === "primary" ? s.buttonPrimaryPressed : s.pressed), (disabled || loading) && s.disabled, style]}>
    {loading ? <ActivityIndicator color={ink} /> : icon ? <Icon name={icon} size={18} tint={ink} /> : null}
    <Text style={[s.buttonText, { color: ink }]}>{title}</Text>
  </Pressable>;
}

export function Banner({ tone: t = "action", title, text, icon }: { tone?: Tone; title?: string; text: string; icon?: IconName }) {
  const c = tone[t];
  return <View style={[s.banner, { backgroundColor: c.soft }]}>
    <Icon name={icon ?? (t === "danger" ? "alert-circle-outline" : t === "warning" ? "warning-outline" : t === "success" ? "checkmark-circle-outline" : "information-circle-outline")} size={20} tint={c.ink} />
    <View style={{ flex: 1 }}>
      {title ? <Text style={[s.bannerTitle, { color: c.ink }]}>{title}</Text> : null}
      <Text style={[s.bannerText, { color: t === "action" || t === "neutral" ? color.text : c.ink }]}>{text}</Text>
    </View>
  </View>;
}

export function EmptyState({ icon = "file-tray-outline", title, text, action }: { icon?: IconName; title: string; text?: string; action?: { label: string; onPress: () => void } }) {
  return <View style={s.empty}>
    <View style={s.emptyIcon}><Icon name={icon} size={26} tint={color.subtle} /></View>
    <Text style={[type.heading, { textAlign: "center" }]}>{title}</Text>
    {text ? <Text style={[type.small, { textAlign: "center" }]}>{text}</Text> : null}
    {action ? <Button title={action.label} onPress={action.onPress} variant="ghost" style={{ marginTop: space.xs }} /> : null}
  </View>;
}

/** Horizontally scrolling page of figures for screens that have more than a summary card can hold. */
export function StatStrip({ items }: { items: { label: string; value: string | number; tone?: Tone }[] }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>{items.map(item =>
    <View key={item.label} style={s.stripItem}>
      <Text style={[s.stripValue, item.tone && item.tone !== "neutral" && { color: tone[item.tone].ink }]} numberOfLines={1}>{item.value}</Text>
      <Text style={s.stripLabel} numberOfLines={1}>{item.label}</Text>
    </View>)}</ScrollView>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export const page = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  content: { width: "100%", paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 120, gap: space.lg },
  contentTablet: { maxWidth: 1040, alignSelf: "center", paddingHorizontal: space.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.page, gap: space.md },
  title: { ...type.display },
  subtitle: { ...type.small, marginTop: -space.sm },
  columns: { flexDirection: "row", gap: space.md },
  column: { flex: 1 },
});

const s = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, backgroundColor: color.page },
  avatar: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: color.brandAccent, fontWeight: "700", fontSize: 15 },
  headerHello: { ...type.heading, fontSize: 17 },
  headerOrg: { ...type.small },
  screenBar: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  screenBarTitle: { ...type.heading, flex: 1, textAlign: "center", fontSize: 17 },
  iconButton: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center" },
  iconButtonSpace: { width: 40 },
  summary: { borderRadius: radius.lg, backgroundColor: color.action, padding: space.xl, gap: 2 },
  summaryLabel: { color: "#c9d6f7", fontSize: 13, fontWeight: "500" },
  summaryValue: { color: "#ffffff", fontSize: 30, lineHeight: 38, fontWeight: "700" },
  summaryCaption: { color: "#dbe4fb", fontSize: 13 },
  summaryStats: { flexDirection: "row", marginTop: space.lg, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.md, paddingVertical: space.md },
  summaryStat: { flex: 1, paddingHorizontal: space.md },
  summaryStatBorder: { borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.2)" },
  summaryStatValue: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  summaryStatLabel: { color: "#c9d6f7", fontSize: 12, marginTop: 2 },
  quick: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  quickTile: { flexGrow: 1, flexBasis: "28%", minHeight: 96, borderRadius: radius.lg, backgroundColor: color.surface, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.md, ...shadow.card },
  quickIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  quickLabel: { ...type.label, textAlign: "center", fontSize: 13 },
  section: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: -space.xs },
  sectionAction: { color: color.action, fontSize: 13, fontWeight: "600" },
  badge: { alignSelf: "flex-end", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, fontWeight: "600", overflow: "hidden", textTransform: "capitalize" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, ...shadow.card },
  rowIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...type.heading, fontSize: 15 },
  rowSubtitle: { ...type.small, marginTop: 1 },
  rowEnd: { alignItems: "flex-end", gap: 3, maxWidth: "45%" },
  rowValue: { ...type.heading, fontSize: 15 },
  rowDetail: { ...type.caption },
  segmented: { flexDirection: "row", backgroundColor: "#e8edf3", borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 38, borderRadius: radius.sm + 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
  segmentActive: { backgroundColor: color.surface, ...shadow.card },
  segmentText: { color: color.muted, fontSize: 13, fontWeight: "600" },
  segmentTextActive: { color: color.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 38, borderRadius: radius.pill, backgroundColor: color.fill, paddingHorizontal: 14 },
  chipActive: { backgroundColor: color.actionSoft },
  chipText: { color: color.text, fontSize: 13, fontWeight: "500", textTransform: "capitalize" },
  chipTextActive: { color: color.actionInk, fontWeight: "600" },
  field: { gap: 6 },
  fieldHint: { ...type.caption },
  fieldError: { ...type.caption, color: color.danger },
  input: { minHeight: 50, borderRadius: radius.md, backgroundColor: color.fill, borderWidth: 1, borderColor: color.fill, paddingHorizontal: 14, fontSize: 15, color: color.ink },
  inputFocused: { borderColor: color.action, backgroundColor: color.surface },
  textarea: { minHeight: 92, paddingTop: 13, textAlignVertical: "top" },
  moneyEcho: { ...type.caption, color: color.actionInk, marginTop: 4, fontWeight: "600" },
  referenceRow: { flexDirection: "row", gap: space.sm },
  referenceButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 50, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: color.actionSoft },
  referenceButtonText: { color: color.action, fontWeight: "600", fontSize: 13 },
  button: { minHeight: 52, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg },
  button_primary: { backgroundColor: color.action },
  buttonPrimaryPressed: { backgroundColor: color.actionPressed },
  button_secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  button_ghost: { backgroundColor: color.actionSoft },
  button_danger: { backgroundColor: color.dangerSoft },
  buttonText: { fontSize: 15, fontWeight: "600" },
  banner: { flexDirection: "row", gap: space.md, borderRadius: radius.md, padding: space.md },
  bannerTitle: { fontSize: 14, fontWeight: "600" },
  bannerText: { fontSize: 13, lineHeight: 19 },
  empty: { alignItems: "center", gap: space.sm, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.xxl },
  emptyIcon: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: color.fill, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  strip: { gap: space.sm, paddingRight: space.lg },
  stripItem: { minWidth: 120, backgroundColor: color.surface, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, ...shadow.card },
  stripValue: { ...type.heading, fontSize: 17 },
  stripLabel: { ...type.caption, marginTop: 2 },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow.card },
});
