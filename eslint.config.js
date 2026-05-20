import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    files: ["src/lib/time.ts", "src/lib/time.test.ts", "src/lib/dates.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "no-restricted-syntax": [
        "warn",
        {
          selector: "CallExpression[callee.property.name='getDate']",
          message:
            "Use isoDayInTz / addDaysInTz / parseIsoDay from @/lib/time instead of Date.getDate(). See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='getMonth']",
          message:
            "Use isoDayInTz from @/lib/time instead of Date.getMonth(). See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='getFullYear']",
          message:
            "Use isoDayInTz from @/lib/time instead of Date.getFullYear(). See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='getDay']",
          message:
            "Use dayOfWeekInTz from @/lib/time instead of Date.getDay(). See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='getHours']",
          message:
            "Use formatTimeInTz from @/lib/time instead of Date.getHours(). See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='getMinutes']",
          message:
            "Use formatTimeInTz from @/lib/time instead of Date.getMinutes(). See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='getSeconds']",
          message:
            "Avoid Date.getSeconds() — operate via @/lib/time helpers. See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message:
            "Use @/lib/dates formatDate* helpers (display) or @/lib/time helpers (logic). Never toLocaleDateString directly. See styling doc section 25.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleTimeString']",
          message: "Use formatTimeInTz from @/lib/time. See styling doc section 25.",
        },
        {
          selector:
            "MemberExpression[object.callee.property.name='toISOString'][property.name='slice']",
          message:
            "Never use toISOString().slice() for date keying — it forces UTC. Use isoDayInTz from @/lib/time. See styling doc section 25.",
        },
      ],
    },
  },
  eslintPluginPrettier,
);
