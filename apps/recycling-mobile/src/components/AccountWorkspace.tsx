import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { DeviceSecuritySettings } from "./DeviceSecuritySettings";

type AccountUser = { fullName: string; email: string; roles: string[] };

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
      <Text style={s.title}>My account</Text>
      <Text style={s.subtitle}>Your identity, organization and application settings.</Text>
      <View style={s.card}>
        {photo ? (
          <Image source={{ uri: photo }} style={s.avatar} />
        ) : (
          <View style={s.fallback}><Text style={s.initials}>{user.fullName.slice(0, 2).toUpperCase()}</Text></View>
        )}
        <View style={s.copy}>
          <Text style={s.name}>{user.fullName}</Text>
          <Text style={s.muted}>{user.email}</Text>
          {organizationName ? <Text style={s.organization}>{organizationName}</Text> : null}
          <Text style={s.roles}>{user.roles.map((role) => role.replaceAll("_", " ")).join(" · ")}</Text>
        </View>
      </View>
      <Pressable onPress={() => void choosePhoto()} style={s.action}>
        <View style={s.copy}>
          <Text style={s.actionTitle}>Upload profile picture</Text>
          <Text style={s.muted}>Choose and crop a photo from this device.</Text>
        </View>
        <Text style={s.actionLink}>Choose photo</Text>
      </Pressable>
      <View style={s.action}>
        <View style={s.copy}>
          <Text style={s.actionTitle}>Edit account details</Text>
          <Text style={s.muted}>Names, email and access roles are managed by your organization administrator to protect synchronized records.</Text>
        </View>
      </View>
      <DeviceSecuritySettings onLogout={onLogout} />
    </>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 30, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748b", fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 20 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#dfe4ea", padding: 18, flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 14 },
  avatar: { width: 76, height: 76, borderRadius: 38 },
  fallback: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#151b2b", alignItems: "center", justifyContent: "center" },
  initials: { color: "#f0b35a", fontSize: 22, fontWeight: "900" },
  copy: { flex: 1 },
  name: { color: "#111827", fontSize: 22, fontWeight: "800" },
  muted: { color: "#64748b", fontSize: 13, lineHeight: 19, marginTop: 3 },
  organization: { color: "#334155", fontSize: 14, fontWeight: "700", marginTop: 8 },
  roles: { color: "#3156a3", fontWeight: "800", textTransform: "capitalize", marginTop: 6 },
  action: { minHeight: 72, backgroundColor: "#fff", borderWidth: 1, borderColor: "#dfe4ea", padding: 16, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  actionTitle: { color: "#111827", fontSize: 16, fontWeight: "800" },
  actionLink: { color: "#3156a3", fontWeight: "800" },
});
