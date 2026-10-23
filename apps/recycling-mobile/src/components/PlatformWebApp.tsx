import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { centralLogin, clearSession, getSavedAccount, restoreSession, saveSession, unlockSavedAccount, updateDevicePin } from "../lib/auth-session";
import { getMobileSyncState, initializeMobileStorage, mobileRequest, syncMobileOutbox, watchConnectivity } from "../lib/mobile-api";
import type { MobileUser } from "../lib/auth-session";
import { AccountWorkspace } from "./AccountWorkspace";

const WEB_URL = (process.env.EXPO_PUBLIC_WEB_BASE_URL || "https://kampalawms.com").replace(/\/$/, "");
type RpcRequest = { id: string; method: string; args?: unknown[] };

const bridgeScript = `(function(){
if(window.__KWMS_MOBILE_BRIDGE__)return true;window.__KWMS_MOBILE_BRIDGE__=true;
var mobileStyle=document.createElement('style');mobileStyle.id='kwms-native-mobile-shell';mobileStyle.textContent='body>div.min-h-screen>aside,body>div.min-h-screen>main>header,body>div.min-h-screen>main>details,body>div.min-h-screen>nav[aria-label="Main navigation"]{display:none!important}body>div.min-h-screen>main{padding-left:0!important;padding-bottom:0!important}body>div.min-h-screen>main>section{padding-top:12px!important}html,body,body>div:first-child{margin-top:0!important;padding-top:0!important}';document.documentElement.appendChild(mobileStyle);
var pending={},nextId=1;
function call(method,args){return new Promise(function(resolve,reject){var id=String(nextId++);pending[id]={resolve:resolve,reject:reject};window.ReactNativeWebView.postMessage(JSON.stringify({id:id,method:method,args:args||[]}));});}
window.__kwmsResolve=function(id,ok,payload){var request=pending[id];if(!request)return;delete pending[id];if(ok)request.resolve(payload);else request.reject(new Error((payload&&payload.message)||'The request could not be completed'));};
window.kwmsDesktop={
centralLogin:function(email,password,options){return call('centralLogin',[email,password,options||{}]).then(function(result){if(result&&result.tokens&&result.user){sessionStorage.setItem('accessToken',result.tokens.accessToken);sessionStorage.setItem('refreshToken',result.tokens.refreshToken||'');sessionStorage.setItem('currentUser',JSON.stringify(Object.assign({},result.user,{roles:result.roles||[]})));setTimeout(function(){window.location.href=result.destination||'/dashboard';},0);}return result;});},getSavedAccount:function(){return call('getSavedAccount');},unlockSavedAccount:function(input){return call('unlockSavedAccount',[input||{}]);},updateDevicePin:function(pin){return call('updateDevicePin',[pin]);},offlineLogin:function(email,pin){return call('unlockSavedAccount',[{pin:pin,email:email}]);},resumeSavedAuth:function(){return call('resumeSavedAuth');},offlineLogout:function(){return call('offlineLogout');},revokeOfflineAuth:function(){return call('offlineLogout');},centralApiRequest:function(input){return call('centralApiRequest',[input]);},getCachedApiResponse:function(){return Promise.resolve(null);},cacheApiResponse:function(){return Promise.resolve(true);},queueOffline:function(input){return call('queueOffline',[input]);},queue:function(input){return call('queueOffline',[input]);},syncNow:function(){return call('syncNow');},reconnect:function(){return call('getState');},getState:function(){return call('getState');},getSnapshots:function(){return Promise.resolve([]);},setSnapshot:function(input){return Promise.resolve(input);},retry:function(){return call('syncNow');},discard:function(){return call('getState');},checkForUpdates:function(){return call('checkForUpdates');},downloadUpdate:function(){return call('downloadUpdate');},installUpdate:function(){return call('installUpdate');},onState:function(){return function(){};}};return true;})();`;

export function PlatformWebApp() {
  const { width } = useWindowDimensions();
  const tablet = width >= 760;
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [activeUser, setActiveUser] = useState<MobileUser | null>(null);
  const [activePath, setActivePath] = useState("/login");
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const sessionRef = useRef<{ token: string; email: string } | null>(null);
  const connectivityRef=useRef<null|(()=>void)>(null);
  const updateRef = useRef<{ status: "idle" | "checking" | "available" | "downloading" | "ready" | "current" | "error"; availableVersion: string | null; error: string | null; progress: number | null }>({ status: "idle", availableVersion: null, error: null, progress: null });

  const activateSession=useCallback(async(token:string,email:string)=>{sessionRef.current={token,email};await initializeMobileStorage(email);connectivityRef.current?.();connectivityRef.current=watchConnectivity(token,email,()=>{web.current?.injectJavaScript(`window.dispatchEvent(new Event('kwms-sync-complete'));true;`);});},[]);
  useEffect(() => { void restoreSession().then(async ({ session }) => { if (session) { setActiveUser(session.user); await activateSession(session.token,session.user.email); } else await initializeMobileStorage(); setReady(true); }).catch(() => setReady(true));return()=>connectivityRef.current?.(); }, [activateSession]);
  useEffect(() => { const subscription = BackHandler.addEventListener("hardwareBackPress", () => { if (!canGoBack) return false; web.current?.goBack(); return true; }); return () => subscription.remove(); }, [canGoBack]);

  const respond = useCallback((id: string, ok: boolean, payload: unknown) => { const serialized = JSON.stringify(payload ?? null).replace(/</g, "\\u003c"); web.current?.injectJavaScript(`window.__kwmsResolve(${JSON.stringify(id)},${ok ? "true" : "false"},${serialized});true;`); }, []);
  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    let request: RpcRequest; try { request = JSON.parse(event.nativeEvent.data) as RpcRequest; } catch { return; }
    const args = request.args || [];
    try {
      let result: unknown;
      if (request.method === "centralLogin") {
        const email = String(args[0] || ""), password = String(args[1] || ""), options = (args[2] || {}) as { rememberAccount?: boolean; devicePin?: string };
        const authenticated = await centralLogin(email, password);
        await saveSession(authenticated.user, authenticated.tokens, options.rememberAccount !== false, options.devicePin);
        await activateSession(authenticated.tokens.accessToken,authenticated.user.email);
        setActiveUser(authenticated.user);
        let recyclingCompany = false;
        if (authenticated.user.roles.includes("company_admin")) {
          try {
            const context = await mobileRequest<{ data: { organization: { type: string } } }>("/api/waste/recycling", authenticated.tokens.accessToken, authenticated.user.email);
            recyclingCompany = context.data.organization.type === "recycling_company";
          } catch { /* A non-recycling company is expected to reject this endpoint. */ }
        }
        const roles = authenticated.user.roles;
        const destination = roles.includes("weighbridge_operator") ? "/dashboard/weighbridge/operations" : roles.some((role) => ["recycling_collector", "recycling_sales", "recycling_field_manager"].includes(role)) || recyclingCompany ? "/dashboard/recycling" : roles.includes("driver") ? "/dashboard/driver-mobile" : roles.includes("citizen") ? "/dashboard/citizen-issues" : roles.includes("organization_applicant") ? "/onboarding" : roles.includes("company_admin") ? "/dashboard/company" : "/dashboard";
        setActivePath(destination);
        result = { session: { user: authenticated.user, roles }, user: authenticated.user, roles, tokens: authenticated.tokens, destination, online: true };
      } else if (request.method === "getSavedAccount") {
        result = await getSavedAccount();
      } else if (request.method === "unlockSavedAccount") {
        const authenticated = await unlockSavedAccount((args[0] || {}) as { pin?: string; biometric?: boolean });
        await activateSession(authenticated.token,authenticated.user.email);
        setActiveUser(authenticated.user);
        result = { sessionId: "mobile-offline", offline: true, user: authenticated.user, roles: authenticated.user.roles, lastVerifiedAt: new Date().toISOString() };
      } else if(request.method==="updateDevicePin") { result=await updateDevicePin(String(args[0]||""));
      } else if (request.method === "resumeSavedAuth") {
        const restored = await restoreSession();
        if (!restored.session) result = null;
        else { setActiveUser(restored.session.user); await activateSession(restored.session.token,restored.session.user.email); const network = await NetInfo.fetch(); const online = Boolean(network.isConnected && network.isInternetReachable !== false); result = { session: { user: restored.session.user, roles: restored.session.user.roles }, roles: restored.session.user.roles, tokens: online ? { accessToken: restored.session.token, refreshToken: "" } : undefined, online }; }
      } else if (request.method === "offlineLogout") { sessionRef.current = null; setActiveUser(null); setAccountOpen(false); connectivityRef.current?.();connectivityRef.current=null;await clearSession(false); result = true;
      } else if (request.method === "centralApiRequest" || request.method === "queueOffline") {
        const input = (args[0] || {}) as { path?: string; endpoint?: string; method?: string; headers?: Record<string, string>; body?: string | unknown };
        const active = sessionRef.current, path = input.path || input.endpoint || "/";
        const body = typeof input.body === "string" ? input.body : input.body == null ? undefined : JSON.stringify(input.body);
        const data = await mobileRequest<Record<string, unknown>>(path, active?.token || "", active?.email || "anonymous", { method: input.method || "GET", headers: input.headers, body });
        result = request.method === "centralApiRequest" ? { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(data) } : { id: data.localId || `mobile-${Date.now()}`, ...data };
      } else if (request.method === "syncNow") { const active = sessionRef.current; if (active) await syncMobileOutbox(active.token, active.email); result = await statePayload(updateRef.current);
      } else if (request.method === "checkForUpdates") {
        if (__DEV__ || !Updates.isEnabled) updateRef.current = { status: "current", availableVersion: null, error: null, progress: null };
        else {
          updateRef.current = { ...updateRef.current, status: "checking", error: null };
          try { const update = await Updates.checkForUpdateAsync(); updateRef.current = { status: update.isAvailable ? "available" : "current", availableVersion: update.isAvailable ? "new" : null, error: null, progress: null }; }
          catch (error) { updateRef.current = { status: "error", availableVersion: null, error: error instanceof Error ? error.message : "Update check failed", progress: null }; }
        }
        result = await statePayload(updateRef.current);
      } else if (request.method === "downloadUpdate") {
        updateRef.current = { ...updateRef.current, status: "downloading", progress: 0, error: null };
        try { await Updates.fetchUpdateAsync(); updateRef.current = { ...updateRef.current, status: "ready", progress: 100 }; }
        catch (error) { updateRef.current = { status: "error", availableVersion: null, error: error instanceof Error ? error.message : "Update download failed", progress: null }; }
        result = await statePayload(updateRef.current);
      } else if (request.method === "installUpdate") { if (Updates.isEnabled) await Updates.reloadAsync(); result = true;
      } else if (request.method === "getState") { result = await statePayload(updateRef.current);
      } else throw new Error(`Unsupported mobile bridge method: ${request.method}`);
      respond(request.id, true, result);
    } catch (error) { respond(request.id, false, { message: error instanceof Error ? error.message : "The request could not be completed" }); }
  }, [activateSession,respond]);

  const navItems = useMemo(() => mobileNavigation(activeUser, activePath), [activeUser, activePath]);
  const primaryItems = navItems.slice(0, tablet ? 4 : 3);
  const overflowItems = navItems.slice(tablet ? 4 : 3);

  const openPath = useCallback((path: string) => {
    setAccountOpen(false);
    setMoreOpen(false);
    setActivePath(path);
    web.current?.injectJavaScript(`window.location.href=${JSON.stringify(path)};true;`);
  }, []);

  const logoutFromAccount = useCallback(async () => {
    sessionRef.current = null;
    connectivityRef.current?.();
    connectivityRef.current = null;
    await clearSession(false);
    setActiveUser(null);
    setAccountOpen(false);
    setMoreOpen(false);
    setActivePath("/login");
    web.current?.injectJavaScript(`sessionStorage.clear();localStorage.removeItem('accessToken');localStorage.removeItem('refreshToken');localStorage.removeItem('currentUser');window.location.replace('/login');true;`);
  }, []);

  if (!ready) return <View style={styles.loading}><ActivityIndicator color="#2952cc" size="large" /><Text style={styles.loadingText}>Opening Kampala WMS…</Text></View>;
  return <SafeAreaView style={styles.container}><StatusBar style="dark" />
    <View style={styles.content}>
      <WebView ref={web} source={{ uri: `${WEB_URL}/login` }} style={[styles.web, accountOpen && styles.hidden]} injectedJavaScriptBeforeContentLoaded={bridgeScript} onMessage={onMessage} onNavigationStateChange={(state: WebViewNavigation) => { setCanGoBack(state.canGoBack); try { const url = new URL(state.url); setActivePath(url.pathname); } catch { /* Keep the last valid platform route. */ } }} javaScriptEnabled domStorageEnabled cacheEnabled cacheMode="LOAD_CACHE_ELSE_NETWORK" allowsBackForwardNavigationGestures sharedCookiesEnabled thirdPartyCookiesEnabled setSupportMultipleWindows={false} startInLoadingState renderLoading={() => <View style={styles.loading}><ActivityIndicator color="#2952cc" size="large" /><Text style={styles.loadingText}>Loading your workspace…</Text></View>} />
      {accountOpen && activeUser ? <ScrollView style={styles.account} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={[styles.accountBody, tablet && styles.accountBodyTablet]}><AccountWorkspace user={activeUser} onLogout={logoutFromAccount} /></ScrollView> : null}
    </View>
    {activeUser ? <View style={[styles.bottomNav, tablet && styles.bottomNavTablet]}>
      {primaryItems.map((item) => <NavButton key={item.path} label={item.label} icon={item.icon} active={!accountOpen && activePath.startsWith(item.path)} onPress={() => openPath(item.path)} />)}
      <NavButton label="Account" icon="●" active={accountOpen} onPress={() => { setMoreOpen(false); setAccountOpen(true); }} />
      {overflowItems.length ? <NavButton label="More" icon="•••" active={moreOpen} onPress={() => setMoreOpen(true)} /> : null}
    </View> : null}
    <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)}><Pressable style={styles.overlay} onPress={() => setMoreOpen(false)}><View style={styles.sheet}><View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>YOUR WORKSPACE</Text><Text style={styles.sheetTitle}>All modules</Text></View><Pressable onPress={() => setMoreOpen(false)} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable></View>{overflowItems.map((item) => <Pressable key={item.path} onPress={() => openPath(item.path)} style={styles.module}><Text style={styles.moduleIcon}>{item.icon}</Text><Text style={styles.moduleText}>{item.label}</Text><Text style={styles.moduleArrow}>›</Text></Pressable>)}</View></Pressable></Modal>
  </SafeAreaView>;
}

function NavButton({ label, icon, active, onPress }: { label: string; icon: string; active: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.navButton, active && styles.navButtonActive]}><Text style={[styles.navIcon, active && styles.navActive]}>{icon}</Text><Text numberOfLines={1} style={[styles.navLabel, active && styles.navActive]}>{label}</Text></Pressable>; }

type MobileNavItem = { label: string; path: string; icon: string };
function mobileNavigation(user: MobileUser | null, currentPath: string): MobileNavItem[] {
  if (!user) return [];
  const roles = user.roles || [];
  if (roles.includes("driver")) return [{ label: "My route", path: "/dashboard/driver-mobile", icon: "⌖" }];
  if (roles.includes("weighbridge_operator")) return [{ label: "Record", path: "/dashboard/weighbridge/operations", icon: "+" }, { label: "Transactions", path: "/dashboard/weighbridge", icon: "▤" }];
  if (roles.includes("recycling_collector")) return [{ label: "Materials", path: "/dashboard/recycling", icon: "▦" }];
  if (roles.includes("recycling_sales")) return [{ label: "Sales", path: "/dashboard/recycling", icon: "↗" }];
  if (roles.includes("recycling_field_manager")) return [{ label: "Operations", path: "/dashboard/recycling", icon: "▦" }, { label: "Team", path: "/dashboard/team", icon: "♙" }, { label: "Reports", path: "/dashboard/recycling-reports", icon: "▥" }];
  if (roles.includes("citizen")) return [{ label: "Services", path: "/dashboard/customer-service", icon: "⌂" }, { label: "Billing", path: "/dashboard/billing", icon: "▤" }, { label: "Support", path: "/dashboard/citizen-issues", icon: "◇" }];
  if (roles.includes("company_admin") || roles.includes("supervisor")) {
    const recycling = currentPath.startsWith("/dashboard/recycling");
    return recycling ? [{ label: "Materials", path: "/dashboard/recycling", icon: "▦" }, { label: "Team", path: "/dashboard/team", icon: "♙" }, { label: "Finance", path: "/dashboard/billing", icon: "¤" }, { label: "Reports", path: "/dashboard/reports", icon: "▥" }, { label: "Access", path: "/dashboard/access", icon: "◇" }]
      : [{ label: "Overview", path: "/dashboard/company", icon: "⌂" }, { label: "Operations", path: "/dashboard/waste", icon: "▦" }, { label: "Customers", path: "/dashboard/customer-service", icon: "♙" }, { label: "Finance", path: "/dashboard/billing", icon: "¤" }, { label: "Reports", path: "/dashboard/reports", icon: "▥" }];
  }
  return [{ label: "Overview", path: "/dashboard", icon: "⌂" }, { label: "Operations", path: "/dashboard/waste", icon: "▦" }, { label: "Organizations", path: "/dashboard/organizations", icon: "♙" }, { label: "Reports", path: "/dashboard/city-reports", icon: "▥" }];
}

async function statePayload(update: { status: string; availableVersion: string | null; error: string | null; progress: number | null }) {
  const network = await NetInfo.fetch();
  const sync=getMobileSyncState();
  return { isDesktop: true, online: Boolean(network.isConnected && network.isInternetReachable !== false), serverUrl: WEB_URL, lastCheckedAt: sync.lastSyncedAt||new Date().toISOString(), secureStorageAvailable: true, pendingCount: sync.pending, failedCount: sync.conflicts+(sync.lastError?1:0), syncedCount: 0, syncing: sync.syncing, appVersion: Constants.expoConfig?.version || "1.0.4", updateStatus: update.status, availableVersion: update.availableVersion, updateError: update.error, updateProgress: update.progress, queue: [] };
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: "#f5f7fa" }, content: { flex: 1 }, web: { flex: 1, backgroundColor: "#f5f7fa" }, hidden: { position: "absolute", top: 0, left: 0, width: 1, height: 1, opacity: 0, flex: 0 }, account: { flex: 1, backgroundColor: "#f5f7fa" }, accountBody: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 0, paddingBottom: 32 }, accountBodyTablet: { width: "100%", maxWidth: 920, alignSelf: "center", paddingHorizontal: 28, paddingTop: 0 }, loading: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: "#f5f7fa", zIndex: 10 }, loadingText: { color: "#52627a", fontSize: 15, fontWeight: "600" }, bottomNav: { minHeight: 68, flexDirection: "row", alignItems: "stretch", borderTopWidth: 1, borderTopColor: "#dbe2eb", backgroundColor: "#fff", paddingHorizontal: 6, paddingBottom: 4 }, bottomNavTablet: { minHeight: 72, paddingHorizontal: 28 }, navButton: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", borderRadius: 12, marginHorizontal: 2, paddingVertical: 7 }, navButtonActive: { backgroundColor: "#eef4ff" }, navIcon: { color: "#738198", fontSize: 19, fontWeight: "700", lineHeight: 23 }, navLabel: { color: "#738198", fontSize: 10, fontWeight: "600", marginTop: 2 }, navActive: { color: "#2952cc" }, overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,18,32,.48)" }, sheet: { maxHeight: "76%", backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 28 }, sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingBottom: 14 }, sheetEyebrow: { color: "#2952cc", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 }, sheetTitle: { color: "#0f172a", fontSize: 24, fontWeight: "700", marginTop: 4 }, close: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }, closeText: { color: "#52627a", fontWeight: "600" }, module: { minHeight: 58, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#edf1f5", gap: 14 }, moduleIcon: { width: 30, color: "#2952cc", fontSize: 20, textAlign: "center", fontWeight: "700" }, moduleText: { flex: 1, color: "#0f172a", fontSize: 15, fontWeight: "600" }, moduleArrow: { color: "#8995a8", fontSize: 27 } });
