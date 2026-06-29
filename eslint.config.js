const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoConfig,
  {
    rules: {
      // @/ path aliases are resolved by Metro/TypeScript, not ESLint's resolver
      "import/no-unresolved": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", ".expo/**", "src/**"],
  },
]);
