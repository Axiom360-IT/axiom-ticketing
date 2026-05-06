import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Accessibility (WCAG 2.1 AA) — per ARCHITECTURE §19.
// `eslint-config-next` already registers the `jsx-a11y` plugin and enables a
// baseline of rules. We layer additional strict rules on top here without
// redefining the plugin (which would cause "Cannot redefine plugin" errors).
const a11yStrictRules = {
  rules: {
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/anchor-has-content": "error",
    "jsx-a11y/anchor-is-valid": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/interactive-supports-focus": "error",
    "jsx-a11y/label-has-associated-control": "error",
    "jsx-a11y/no-noninteractive-element-interactions": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
    "jsx-a11y/role-has-required-aria-props": "error",
    "jsx-a11y/role-supports-aria-props": "error",
    "jsx-a11y/heading-has-content": "error",
    "jsx-a11y/iframe-has-title": "error",
    "jsx-a11y/img-redundant-alt": "warn",
    "jsx-a11y/no-autofocus": ["warn", { ignoreNonDOM: true }],
    "jsx-a11y/no-redundant-roles": "error",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  a11yStrictRules,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
