import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

export type RoleNavigationItem = {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  onPress: () => void;
};

/**
 * Shared post-login navigation. Keeping this in one component prevents each
 * operational workspace from inventing a different mobile navigation model.
 */
export function RoleBottomNavigation({ items }: { items: RoleNavigationItem[] }) {
  const { width } = useWindowDimensions();
  const tablet = width >= 760;

  return (
    <View style={[styles.shell, tablet && styles.shellTablet]} accessibilityRole="tablist">
      {items.slice(0, 5).map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: Boolean(item.active) }}
          onPress={item.onPress}
          style={({ pressed }) => [
            styles.item,
            item.active && styles.itemActive,
            pressed && styles.itemPressed,
          ]}
        >
          <Text style={[styles.icon, item.active && styles.textActive]}>{item.icon}</Text>
          <Text numberOfLines={1} style={[styles.label, item.active && styles.textActive]}>
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
    bottom: 10,
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    padding: 6,
    borderRadius: 24,
    backgroundColor: "#151b2b",
    shadowColor: "#0b1220",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  shellTablet: {
    left: "19%",
    right: "19%",
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 4,
  },
  itemActive: { backgroundColor: "#ffffff" },
  itemPressed: { opacity: 0.72 },
  icon: { color: "#aeb9cd", fontSize: 18, fontWeight: "800" },
  label: { color: "#aeb9cd", fontSize: 10, fontWeight: "800" },
  textActive: { color: "#16223a" },
});
