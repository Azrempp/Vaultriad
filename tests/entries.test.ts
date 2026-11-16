import { describe, it, expect } from "vitest";
import { stageSecret, resolvePending } from "../src/main/entries";
import { preset, type Entry } from "../src/shared/types";
const entry: Entry = {
  id: "id",
  name: "Router",
  username: "admin",
  location: "192.168.1.1",
  notes: "",
  tags: [],
  category: "hardware",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  rotatedAt: "2026-01-01",
  rotationDays: 90,
  rules: preset("hardware"),
  current: "working-secret",
  past: [],
  pending: null,
};
describe("pending safety flow", () => {
  it("staging preserves Current; confirming archives it", () => {
    const staged = stageSecret(entry, "replacement");
    expect(staged.current).toBe("working-secret");
    expect(entry.pending).toBeNull();
    expect(() => stageSecret(staged, "another")).toThrow();
    const done = resolvePending(staged, true);
    expect(done.current).toBe("replacement");
    expect(done.past[0].value).toBe("working-secret");
    expect(done.pending).toBeNull();
    expect(staged.past).toEqual([]);
  });
  it("discard never loses Current or history", () => {
    const done = resolvePending(stageSecret(entry, "bad replacement"), false);
    expect(done.current).toBe(entry.current);
    expect(done.past).toEqual(entry.past);
    expect(done.pending).toBeNull();
    expect(() => resolvePending(done, true)).toThrow();
  });
});
