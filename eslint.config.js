const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// Patch the expo config to allow underscore-prefixed unused vars
const patchedExpoConfig = expoConfig.map((cfg) => {
  if (!cfg.rules) return cfg;
  const patched = { ...cfg, rules: { ...cfg.rules } };
  if (patched.rules["@typescript-eslint/no-unused-vars"]) {
    patched.rules["@typescript-eslint/no-unused-vars"] = [
      "warn",
      { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ];
  }
  if (patched.rules["no-unused-vars"]) {
    patched.rules["no-unused-vars"] = [
      "warn",
      { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ];
  }
  return patched;
});

module.exports = defineConfig([
  ...patchedExpoConfig,
  {
    rules: {
      // @/ path aliases are resolved by Metro/TypeScript, not ESLint's resolver
      "import/no-unresolved": "off",
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".expo/**",
      "src/**",
      ".bun/**",
      "babel-plugins/**",
    ],
  },
]);
