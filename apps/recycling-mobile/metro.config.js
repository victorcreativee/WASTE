// Metro configuration: Expo defaults, plus the wasm engine expo-sqlite uses when the app is opened in a browser to review
// screens. Native builds are unaffected. (The browser page must also be cross-origin isolated for expo-sqlite to start.)
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("wasm");

module.exports = config;
