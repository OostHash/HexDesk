// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import boundaries from "eslint-plugin-boundaries";
import betterTailwind from "eslint-plugin-better-tailwindcss";
import globals from "globals";

/** Layers of src/ (. Lowest first. */
const ELEMENTS = [
  { type: "lib", pattern: "src/lib" },
  { type: "theme", pattern: "src/theme" },
  { type: "domain", pattern: "src/domain" },
  { type: "api", pattern: "src/api" },
  { type: "state", pattern: "src/state" },
  { type: "primitives", pattern: "src/primitives" },
  { type: "patterns", pattern: "src/patterns" },
  { type: "screens", pattern: "src/screens/*", capture: ["screen"] },
  { type: "app", pattern: "src/app" },
  { type: "dev", pattern: "src/dev" },
];

const allow = (from, ...to) => ({
  from: { element: { type: from } },
  allow: { to: { element: { type: to } } },
});

/** Tailwind classes that undo the theme system. */
const RESTRICTED_CLASSES = [
  { pattern: "^(.*:)?dark:.*$", message: "Do not use dark: variants; themes use data-theme and tokens." },
  { pattern: "^(.*:)?light:.*$", message: "Do not use light: variants; themes use data-theme and tokens." },
  { pattern: String.raw`^(.*:)?\[color-scheme:.*\]$`, message: "color-scheme belongs on <html>, not in a component." },
  { pattern: String.raw`^(.*:)?[a-z-]+-\[(#|rgb|hsl|oklch|color-mix).*\]$`, message: "Do not use arbitrary colors; use a semantic role." },
  {
    pattern: String.raw`^(.*:)?-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|rounded|rounded-[a-z]+|text|leading|tracking)-\[.*\]$`,
    message: "Do not use arbitrary sizes; use Tailwind's standard scale.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report", "tests/__screenshots__"] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },

  // Application code
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: {
      boundaries,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "better-tailwindcss": betterTailwind,
    },
    settings: {
      "boundaries/elements": ELEMENTS,
      "boundaries/files": [{ pattern: "**/*.test.{ts,tsx}", category: "test" }],
      "boundaries/include": ["src/**/*"],
      // The entry point only mounts app/; it is not a layer of its own.
      "boundaries/ignore": ["src/main.tsx"],
      "import/resolver": { typescript: { project: "./tsconfig.app.json" } },
      "better-tailwindcss": { entryPoint: "src/theme/index.css" },
    },
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      ...jsxA11y.flatConfigs.strict.rules,

      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message: "Layer {{ from.element.type }} may not import {{ to.element.type }}.",
          policies: [
            allow("lib", "lib"),
            allow("theme", "theme"),
            allow("domain", "domain", "lib"),
            allow("api", "api", "domain", "lib"),
            allow("state", "state", "domain", "theme", "lib"),
            allow("primitives", "primitives", "theme", "lib"),
            allow("patterns", "patterns", "primitives", "lib"),
            allow("screens", "patterns", "primitives", "api", "state", "domain", "lib"),
            {
              from: { element: { type: "screens" } },
              allow: { to: { element: { type: "screens", captured: { screen: "{{ from.element.captured.screen }}" } } } },
            },
            allow("app", "app", "screens", "patterns", "primitives", "api", "state", "domain", "theme", "lib"),
            allow("dev", "dev", "app", "screens", "patterns", "primitives", "api", "state", "domain", "theme", "lib"),
            // Tests may use dev fixtures and mocks; production code may not.
            { from: { file: { categories: "test" } }, allow: { to: { element: { types: ["dev", "theme"] } } } },
            // Libraries are allowed everywhere unless restricted below.
            { allow: { to: { module: { origin: ["external", "core"] } } } },
          ],
        },
      ],

      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/../src/**", "../../src/*", "../../../src/*"], message: "The frontend may not import files outside its own package." },
          ],
        },
      ],

      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/#[0-9a-fA-F]{3,8}([^0-9a-zA-Z]|$)/]", message: "Do not use hex colors outside theme/; use a token." },
        { selector: "Literal[value=/(rgb|rgba|hsl|hsla|oklch)[(]/]", message: "Do not use color functions outside theme/; use a token." },
        { selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}([^0-9a-zA-Z]|$)/]", message: "Do not use hex colors outside theme/; use a token." },
      ],

      "better-tailwindcss/no-unknown-classes": "error",
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "error",
      "better-tailwindcss/no-deprecated-classes": "error",
      "better-tailwindcss/no-restricted-classes": ["error", { restrict: RESTRICTED_CLASSES }],
    },
  },

  // Tauri is reached only through api/ (IPC) and app/ (window management).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/api/**", "src/app/**", "src/dev/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/../src/**", "../../src/*", "../../../src/*"], message: "The frontend may not import files outside its own package." },
            { group: ["@tauri-apps/*"], message: "Use Tauri only through api/ or app/ ." },
          ],
        },
      ],
    },
  },

  // Tests may mock Tauri; the package-boundary rule still applies.
  {
    files: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/../src/**", "../../src/*", "../../../src/*"], message: "The frontend may not import files outside its own package." },
          ],
        },
      ],
    },
  },

  // Theme files may hold raw colour values.
  {
    files: ["src/theme/**"],
    rules: { "no-restricted-syntax": "off" },
  },

  // Tooling and tests run in Node or the test runner.
  {
    files: ["*.config.{ts,js}", "tests/**/*.{ts,tsx}", "scripts/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
