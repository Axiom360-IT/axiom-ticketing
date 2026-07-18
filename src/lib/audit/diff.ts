// Turns the audit log's two partial before/after JSON snapshots into a
// field-level change list, so the UI can render a real "Field: from → to" diff
// (and compact row chips) instead of two opaque blobs. Pure + dependency-free.

export type FieldChange = {
  field: string;
  from: unknown;
  to: unknown;
  kind: "added" | "removed" | "changed";
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Cheap structural compare — audit values are small scalars/objects.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Diff two before/after snapshots into per-field changes. The audit writer
 * records only the fields that changed, so for an update this is typically one
 * "changed" row; a create yields "added" rows (before is null) and a delete
 * yields "removed" rows (after is null).
 */
export function computeChanges(before: unknown, after: unknown): FieldChange[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: FieldChange[] = [];
  for (const field of keys) {
    const inB = Object.prototype.hasOwnProperty.call(b, field);
    const inA = Object.prototype.hasOwnProperty.call(a, field);
    if (inB && inA) {
      if (!sameValue(b[field], a[field])) {
        out.push({ field, from: b[field], to: a[field], kind: "changed" });
      }
    } else if (inA) {
      out.push({ field, from: undefined, to: a[field], kind: "added" });
    } else {
      out.push({ field, from: b[field], to: undefined, kind: "removed" });
    }
  }
  return out;
}

/** True when neither snapshot carries any object fields (nothing to diff). */
export function hasNoStructuredChange(before: unknown, after: unknown): boolean {
  return !isPlainObject(before) && !isPlainObject(after);
}
