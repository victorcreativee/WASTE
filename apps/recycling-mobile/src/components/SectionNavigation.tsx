import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type SectionNavigationItem = {
  id: string;
  label: string;
  active?: boolean;
  onPress: () => void;
};

export function SectionNavigation({
  title,
  items,
}: {
  title?: string;
  items: SectionNavigationItem[];
}) {
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={item.onPress}
            style={({ pressed }) => [styles.item, item.active && styles.itemActive, pressed && styles.pressed]}
          >
            <Text style={[styles.label, item.active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18, gap: 9 },
  title: { color: "#68758b", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  row: { gap: 8, paddingRight: 18 },
  item: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "#d8dfeb",
    backgroundColor: "#ffffff",
  },
  itemActive: { backgroundColor: "#18233a", borderColor: "#18233a" },
  label: { color: "#4e5d76", fontWeight: "800", fontSize: 13 },
  labelActive: { color: "#ffffff" },
  pressed: { opacity: 0.72 },
});
