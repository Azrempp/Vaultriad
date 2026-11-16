import { randomUUID } from "node:crypto";
import type { Entry } from "../shared/types";
export function stageSecret(
  e: Entry,
  value: string,
  now = new Date().toISOString(),
): Entry {
  if (!value) throw Error("Secret cannot be empty.");
  if (e.pending) throw Error("Resolve the existing Pending secret first.");
  return { ...e, pending: { value, createdAt: now }, updatedAt: now };
}
export function resolvePending(
  e: Entry,
  worked: boolean,
  now = new Date().toISOString(),
): Entry {
  if (!e.pending) throw Error("No Pending secret.");
  return {
    ...e,
    ...(worked
      ? {
          current: e.pending.value,
          past: e.current
            ? [
                { id: randomUUID(), value: e.current, replacedAt: now },
                ...e.past,
              ]
            : e.past,
          rotatedAt: now,
        }
      : {}),
    pending: null,
    updatedAt: now,
  };
}
