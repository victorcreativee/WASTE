import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconName } from "../ui/kit";
import { color, radius, shadow } from "../ui/theme";

export type RoleNavigationItem = {
  id: string;
  label: string;
  icon: IconName;
  active?: boolean;
  onPress: () => void;
};

const BAR_HEIGHT = 70;
const BAR_GAP = 8;

/** Distance from the system navigation (gesture bar or 3-button bar) to the bottom of the floating bar. */
function barOffset(bottomInset: number) {
  return Math.max(bottomInset, BAR_GAP) + BAR_GAP;
}

/** Bottom padding a scrolling screen needs so its last item clears the floating bar and the system buttons. */
export function useBottomNavigationSpace() {
  const { bottom } = useSafeAreaInsets();
  return barOffset(bottom) + BAR_HEIGHT + 24;
}

/**
 * Shared post-login navigation. Keeping this in one component prevents each
 * operational workspace from inventing a different mobile navigation model.
 * The active tab becomes a labelled pill; the others show their icon and a short label.
 */
export function RoleBottomNavigation({ items }: { items: RoleNavigationItem[] }) {
  const { width } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const tablet = width >= 760;

  return (
    <View style={[styles.shell, tablet && styles.shellTablet, { bottom: barOffset(bottom) }]} accessibilityRole="tablist">
      {items.slice(0, 5).map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: Boolean(item.active) }}
          onPress={item.onPress}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        >
          <View style={[styles.pill, item.active && styles.pillActive]}>
            <Icon name={item.active ? (String(item.icon).replace("-outline", "") as IconName) : item.icon} size={21} tint={item.active ? color.action : color.muted} />
          </View>
          <Text numberOfLines={1} style={[styles.label, item.active && styles.labelActive]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    height: BAR_HEIGHT,
    paddingHorizontal: 6,
    borderRadius: radius.lg + 4,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    ...shadow.float,
  },
  shellTablet: {
    left: "19%",
    right: "19%",
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  pill: { width: 52, height: 30, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pillActive: { backgroundColor: color.actionSoft },
  itemPressed: { opacity: 0.7 },
  label: { color: color.muted, fontSize: 11, fontWeight: "500" },
  labelActive: { color: color.action, fontWeight: "600" },
});
