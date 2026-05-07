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

// shadcn-generated UI primitives are generic — labels live without an
// associated control, and components use Base UI's render-prop pattern that
// confuses some a11y rules. We trust shadcn's a11y; consumers wire labels
// to controls correctly when used.
const shadcnExceptions = {
  files: ["src/components/ui/**/*.{ts,tsx}"],
  rules: {
    "jsx-a11y/label-has-associated-control": "off",
  },
};

// Server Components legitimately call side-effecting Next.js APIs (redirect,
// headers, cookies, draftMode). React Compiler's purity rule is for client
// renders and doesn't apply to server-only render paths.
const serverComponentExceptions = {
  files: ["src/app/**/*.{ts,tsx}", "src/middleware.ts"],
  rules: {
    "react-hooks/purity": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  a11yStrictRules,
  shadcnExceptions,
  serverComponentExceptions,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
