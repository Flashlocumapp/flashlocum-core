module.exports = function (api) {
  api.cache(true);

  let EDITABLE_COMPONENTS = [];
  try {
    if (
      process.env.EXPO_PUBLIC_ENABLE_EDIT_MODE === "TRUE" &&
      process.env.NODE_ENV === "development" &&
      !process.env.EXPO_PLATFORM // skip entirely when running under Expo/Metro
    ) {
      EDITABLE_COMPONENTS = [
        ["./babel-plugins/editable-elements.js", {}],
        ["./babel-plugins/inject-source-location.js", {}],
      ];
    }
  } catch (_) {
    // babel-plugins not available in this environment
  }

  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./"],
          extensions: [
            ".ios.ts",
            ".android.ts",
            ".ts",
            ".ios.tsx",
            ".android.tsx",
            ".tsx",
            ".jsx",
            ".js",
            ".json",
          ],
          alias: {
            "@": "./",
            "@components": "./components",
            "@style": "./style",
            "@hooks": "./hooks",
            "@types": "./types",
            "@contexts": "./contexts",
            "@lib": "./lib",
          },
        },
      ],
      ...EDITABLE_COMPONENTS,
      "@babel/plugin-proposal-export-namespace-from",
      "react-native-worklets/plugin", // react-native-worklets/plugin must be listed last!
    ],
  };
};
