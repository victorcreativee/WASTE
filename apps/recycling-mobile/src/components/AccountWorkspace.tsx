import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "../lib/secure-store";
import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import { Card, ListRow, SectionHeader, StatusBadge } from "../ui/kit";
import { color, initials, radius, space, type } from "../ui/theme";
import { DeviceSecuritySettings } from "./DeviceSecuritySettings";

type AccountUser = { fullName: string; email: string; roles: string[] };

const ROLE_LABEL: Record<string, string> = {
  recycling_collector: "Field buyer", recycling_sales: "Industrial sales", recycling_field_manager: "Field manager",
  company_admin: "Company administrator", supervisor: "Supervisor", driver: "Driver", kcca_admin: "KCCA officer",
  system_admin: "Platform administrator", weighbridge_operator: "Weighbridge operator",
};

export function AccountWorkspace({
  user,
  organizationName,
  onLogout,
}: {
  user: AccountUser;
  organizationName?: string;
  onLogout: () => Promise<void>;
}) {
  const key = `kwms.profilePhoto.${user.email.toLowerCase()}`;
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    void SecureStore.getItemAsync(key).then(setPhoto).catch(() => undefined);
  }, [key]);

  async function choosePhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    await SecureStore.setItemAsync(key, result.assets[0].uri);
    setPhoto(result.assets[0].uri);
  }

  return (
    <>
      <Text style={type.display}>Account</Text>
      <Card style={s.profile}>
        {photo ? <Image source={{ uri: photo }} style={s.avatar} /> : <View style={s.fallback}><Text style={s.initials}>{initials(user.fullName)}</Text></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={type.title} numberOfLines={1}>{user.fullName}</Text>
          <Text style={type.small} numberOfLines={1}>{user.email}</Text>
          {organizationName ? <Text style={[type.small, { color: color.text }]} numberOfLines={1}>{organizationName}</Text> : null}
          <View style={s.roles}>{user.roles.map((role) => <StatusBadge key={role} label={ROLE_LABEL[role] || role.replaceAll("_", " ")} tone="action" />)}</View>
        </View>
      </Card>

      <SectionHeader title="Profile" />
      <View style={{ gap: space.sm }}>
        <ListRow icon="image-outline" iconTone="action" title="Profile picture" subtitle={photo ? "Change the photo on this phone" : "Add a photo from this phone"} onPress={() => void choosePhoto()} chevron />
        <ListRow icon="id-card-outline" title="Name, email and role" subtitle="Managed by your administrator"
          onPress={() => Alert.alert("Account details", "Your name, email and role are managed by your organization administrator, so records stay consistent across the platform. Ask them to make any change.")} chevron />
      </View>

      <DeviceSecuritySettings onLogout={onLogout} />
    </>
  );
}

const s = StyleSheet.create({
  profile: { flexDirection: "row", alignItems: "center", gap: space.lg },
  avatar: { width: 68, height: 68, borderRadius: radius.lg },
  fallback: { width: 68, height: 68, borderRadius: radius.lg, backgroundColor: color.brand, alignItems: "center", justifyContent: "center" },
  initials: { color: color.brandAccent, fontSize: 22, fontWeight: "700" },
  roles: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
});
