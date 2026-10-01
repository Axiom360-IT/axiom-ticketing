import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";

/**
 * next-intl resolves a missing message key to the key PATH and carries on —
 * "moderation.participants.approve" renders as those literal characters on
 * the button. Nothing else in this repo catches that: tsc doesn't type
 * message keys, eslint doesn't resolve them, and `next build` renders no
 * pages that would surface it. Both defects this guards against shipped
 * through a clean typecheck, lint, test and build.
 *
 * So: read the source, find every translator and every literal key passed to
 * one, and resolve it against en.json the way next-intl would.
 *
 * Deliberately filesystem-based rather than importing the modules — most of
 * them are `server-only` and several pull in Resend, so vitest can't load
 * them at all.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "messages" || entry.name === "node_modules") continue;
      sourceFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(path);
  }
  return out;
}

function lookup(path: string): unknown {
  let node: unknown = en;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** `const t = useTranslations("ns")` / `getTranslations("ns")`. */
const DECL_POSITIONAL =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["'`]([^"'`]+)["'`]/g;

/** `const t = await getTranslations({ locale, namespace: "ns" })`. */
const DECL_NAMESPACE =
  /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?getTranslations\(\s*\{[^}]*namespace:\s*["'`]([^"'`]+)["'`]/g;

/** Email templates wrap the translator: `withEmailOverrides(key, locale, await getTranslations({namespace: "ns"}))`. */
const DECL_EMAIL_OVERRIDE =
  /(?:const|let)\s+(\w+)\s*=\s*await\s+withEmailOverrides\([\s\S]{0,200}?namespace:\s*["'`]([^"'`]+)["'`]/g;

type Declaration = { at: number; variable: string; namespace: string };

/**
 * One file commonly declares `t` several times — badges.tsx has six, one per
 * component, each on a different namespace. So declarations are kept as a
 * position-ordered list and each call resolves against the NEAREST PRECEDING
 * declaration of that name, which is what lexical scoping amounts to for the
 * one-translator-per-component style used throughout.
 */
function translatorsIn(source: string): Declaration[] {
  const found: Declaration[] = [];
  for (const re of [DECL_POSITIONAL, DECL_NAMESPACE, DECL_EMAIL_OVERRIDE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      found.push({ at: m.index, variable: m[1], namespace: m[2] });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

function namespaceFor(
  declarations: Declaration[],
  variable: string,
  at: number,
): string | null {
  let best: string | null = null;
  for (const d of declarations) {
    if (d.at > at) break;
    if (d.variable === variable) best = d.namespace;
  }
  return best;
}

describe("translation keys resolve", () => {
  it("every literal key passed to a translator exists in en.json", () => {
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const declarations = translatorsIn(source);
      if (declarations.length === 0) continue;

      for (const variable of new Set(declarations.map((d) => d.variable))) {
        // `t("key")`, `t.rich("key")`, `t.markup("key")` — literal keys only;
        // a template literal is dynamic and can't be checked statically.
        const call = new RegExp(
          `\\b${variable}(?:\\.(?:rich|markup))?\\(\\s*["']([A-Za-z0-9_.]+)["']`,
          "g",
        );
        let m: RegExpExecArray | null;
        while ((m = call.exec(source))) {
          const namespace = namespaceFor(declarations, variable, m.index);
          if (!namespace) continue;
          const full = `${namespace}.${m[1]}`;
          if (typeof lookup(full) !== "string") {
            missing.push(`${file.slice(SRC.length + 1)} -> ${full}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("every email template namespace has a subject", () => {
    // send.tsx renders subjects outside the template component, via
    // `tr("subject", values)` against TEMPLATE_NAMESPACE[template]. That
    // namespace is dynamic, so the scan above can't see it — and a template
    // whose block has no `subject` ships with the literal key path as its
    // Subject header.
    const send = readFileSync(
      join(SRC, "lib", "email", "send.tsx"),
      "utf8",
    );
    const block = send.match(
      /const TEMPLATE_NAMESPACE[^=]*=\s*\{([\s\S]*?)\n\}/,
    );
    expect(block, "TEMPLATE_NAMESPACE map not found in send.tsx").toBeTruthy();

    const namespaces = [
      ...block![1].matchAll(/^\s*\w+:\s*["'`]([^"'`]+)["'`]/gm),
    ].map((m) => m[1]);
    expect(namespaces.length).toBeGreaterThan(20);

    const withoutSubject = namespaces.filter(
      (ns) => typeof lookup(`${ns}.subject`) !== "string",
    );
    expect(withoutSubject).toEqual([]);
  });
});
