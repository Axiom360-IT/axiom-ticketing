import "server-only";
import { getSetting } from "@/lib/settings";
import {
  parseUndelegableDisplay,
  type UndelegableDisplay,
} from "./rank";

/** The Technical Lead's choice: hide what a caller cannot delegate, or show it
 *  locked. Defaults to hidden, and so does anything unreadable — an unset,
 *  corrupted or missing value must never fall into the MORE revealing mode. */
export async function getUndelegableDisplay(): Promise<UndelegableDisplay> {
  try {
    return parseUndelegableDisplay(
      await getSetting<string>("permissions.undelegable_display"),
    );
  } catch {
    return "hidden";
  }
}
