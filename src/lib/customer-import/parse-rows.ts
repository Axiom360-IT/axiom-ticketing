// Pure (no server-only deps) so it's usable from unit tests and the client
// wizard alike — mirrors the domain-guess.ts split for the same reason.

export type ParsedImportRow = { name: string; email: string; phone: string };

/**
 * Splits one line on `delimiter`, respecting double-quoted fields (so a
 * delimiter — or the OTHER delimiter — inside quotes doesn't split the
 * field) and `""` as an escaped literal quote within a quoted field.
 * Standard CSV-quoting rules, applied to a single line at a time.
 */
function splitDelimited(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' && current === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses a pasted/uploaded name/email/phone list — tab-delimited if any line
 * contains a tab, comma-delimited otherwise. Quoted fields (`"Smith, John"`)
 * are respected either way, so a comma inside a quoted name doesn't split
 * the row when comma is also the field delimiter. An optional header row
 * ("name", "email...") is detected and skipped.
 */
export function parseImportRows(text: string): ParsedImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  // splitDelimited already strips surrounding quotes as part of the state
  // machine (see the `current === ""` check that opens a quoted field), so
  // no separate quote-stripping pass is needed here.
  const splitLine = (line: string) => splitDelimited(line, delimiter);

  let start = 0;
  const first = splitLine(lines[0]).map((c) => c.toLowerCase());
  if (first[0] === "name" && (first[1] ?? "").includes("email")) start = 1;

  const rows: ParsedImportRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    rows.push({ name: cols[0] ?? "", email: cols[1] ?? "", phone: cols[2] ?? "" });
  }
  return rows;
}
