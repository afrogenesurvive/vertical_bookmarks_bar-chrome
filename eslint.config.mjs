import globals from "globals";

export default [
  {
    ignores: ["**/.venv/**", "**/node_modules/**", "**/fontawesome/**"],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-console": "off",
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "warn",
    },
  },
];
