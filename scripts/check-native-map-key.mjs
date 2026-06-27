#!/usr/bin/env node
// scripts/check-native-map-key.mjs
//
// Verifies that the Capacitor native map API key in the JS env
// (VITE_CAPACITOR_MAPS_API_KEY) matches the value declared in the platform
// manifests (Android: AndroidManifest.xml com.google.android.geo.API_KEY;
// iOS: Info.plist GMSApiKey). The platform manifests are the source of
// truth — the env var is a verified mirror passed to GoogleMap.create.
//
// Usage:  node scripts/check-native-map-key.mjs
// Exit:   0 on success, 1 on mismatch / missing key with a platform present.
// Skips:  any platform folder that does not exist (e.g. iOS on Linux CI).

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const ANDROID_MANIFEST = resolve(ROOT, "android/app/src/main/AndroidManifest.xml");
const IOS_PLIST = resolve(ROOT, "ios/App/App/Info.plist");
const ENV_FILE = resolve(ROOT, ".env");

function readEnvKey(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_FILE)) return undefined;
  const txt = readFileSync(ENV_FILE, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) {
      return m[2].replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

function readAndroidKey() {
  if (!existsSync(ANDROID_MANIFEST)) return { present: false };
  const xml = readFileSync(ANDROID_MANIFEST, "utf8");
  const m = xml.match(
    /<meta-data\s+android:name="com\.google\.android\.geo\.API_KEY"\s+android:value="([^"]+)"/,
  );
  return { present: true, key: m?.[1] };
}

function readIosKey() {
  if (!existsSync(IOS_PLIST)) return { present: false };
  const plist = readFileSync(IOS_PLIST, "utf8");
  const m = plist.match(/<key>GMSApiKey<\/key>\s*<string>([^<]+)<\/string>/);
  return { present: true, key: m?.[1] };
}

const envKey = readEnvKey("VITE_CAPACITOR_MAPS_API_KEY");
const android = readAndroidKey();
const ios = readIosKey();

const errors = [];
const platforms = [];

if (android.present) {
  platforms.push("android");
  if (!android.key) {
    errors.push(
      "android: AndroidManifest.xml is missing <meta-data android:name=\"com.google.android.geo.API_KEY\" android:value=\"...\"/>",
    );
  } else if (!envKey) {
    errors.push(
      "android: VITE_CAPACITOR_MAPS_API_KEY is not set, but AndroidManifest.xml has a key.",
    );
  } else if (envKey !== android.key) {
    errors.push(
      "android: VITE_CAPACITOR_MAPS_API_KEY does not match AndroidManifest.xml's com.google.android.geo.API_KEY.",
    );
  }
}

if (ios.present) {
  platforms.push("ios");
  if (!ios.key) {
    errors.push("ios: Info.plist is missing <key>GMSApiKey</key><string>...</string>.");
  } else if (!envKey) {
    errors.push(
      "ios: VITE_CAPACITOR_MAPS_API_KEY is not set, but Info.plist has GMSApiKey.",
    );
  } else if (envKey !== ios.key) {
    errors.push("ios: VITE_CAPACITOR_MAPS_API_KEY does not match Info.plist GMSApiKey.");
  }
}

if (platforms.length === 0) {
  console.log(
    "[check-native-map-key] No native platforms present (android/, ios/). Skipping.",
  );
  process.exit(0);
}

if (errors.length > 0) {
  console.error("[check-native-map-key] FAILED");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nFix by editing the platform manifest first (source of truth), then mirror the value into .env as VITE_CAPACITOR_MAPS_API_KEY.",
  );
  process.exit(1);
}

console.log(
  `[check-native-map-key] OK — native key matches platform manifest (${platforms.join(", ")}).`,
);
process.exit(0);
