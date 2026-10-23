import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type } from "../ui/theme";

export type SectionNavigationItem = {
  id: string;
  label: string;
  active?: boolean;
  onPress: () => void;
};

/** Sub-sections of a screen as soft chips that wrap onto a second line, so every section stays visible on a phone. */
export function SectionNavigation({
  title,
  items,
}: {
  title?: string;
  items: SectionNavigationItem[];
}) {
  return (
    <View style={styles.wrap}>
      {title ? <Text style={type.heading}>{title}</Text> : null}
      <View style={styles.row}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: Boolean(item.active) }}
            onPress={item.onPress}
            style={({ pressed }) => [styles.item, item.active && styles.itemActive, pressed && styles.pressed]}
          >
            <Text style={[styles.label, item.active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  item: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.fill },
  itemActive: { backgroundColor: color.action },
  label: { color: color.text, fontWeight: "500", fontSize: 13 },
  labelActive: { color: "#ffffff", fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
