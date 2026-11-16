import { describe, it, expect } from "vitest";
import { randomInt } from "node:crypto";
import { generate, validateSecret, manualWarnings } from "../src/shared/rules";
import { DEFAULT_RULES, preset } from "../src/shared/types";
const rng = (max: number) => randomInt(max);
describe("password rules", () => {
  it("enforces all category presets over repeated generations", () => {
    for (const category of ["hardware", "domains", "api"] as const)
      for (let i = 0; i < 100; i++) {
        const r = preset(category),
          p = generate(r, rng);
        expect(p.length).toBe(r.length);
        expect(validateSecret(p, r)).toEqual([]);
        expect(p).not.toMatch(/[0O1lI]/);
        if (category === "api") expect(p).toMatch(/^[a-zA-Z0-9]{40}$/);
      }
  });
  it("applies service character restrictions and minimum counts", () => {
    const r = {
      ...DEFAULT_RULES,
      length: 16,
      max: 16,
      truncates: 16,
      allowedSymbols: "@#",
      excluded: "xyzABC",
      minUpper: 3,
      minLower: 3,
      minNumbers: 3,
      minSymbols: 3,
    };
    for (let i = 0; i < 100; i++) {
      const p = generate(r, rng);
      expect(validateSecret(p, r)).toEqual([]);
      expect(p).not.toMatch(/[xyzABC]/);
      expect(p.match(/[@#]/g)!.length).toBeGreaterThanOrEqual(3);
    }
  });
  it("rejects impossible combinations instead of hanging or weakening rules", () => {
    for (const r of [
      { ...DEFAULT_RULES, length: 8, minUpper: 10 },
      { ...DEFAULT_RULES, allowed: "x" },
      { ...DEFAULT_RULES, truncates: 12 },
      {
        ...DEFAULT_RULES,
        upper: false,
        lower: false,
        numbers: false,
        symbols: false,
      },
      { ...DEFAULT_RULES, min: 40, max: 50 },
    ])
      expect(() => generate(r, rng)).toThrow(/Impossible/);
  });
  it("generates passphrases subject to service constraints", () => {
    const r = {
      ...DEFAULT_RULES,
      mode: "passphrase" as const,
      min: 8,
      max: 128,
      words: 8,
      minUpper: 0,
      minNumbers: 0,
      minSymbols: 0,
    };
    const p = generate(r, rng);
    expect(p.split("-")).toHaveLength(8);
    expect(validateSecret(p, r)).toEqual([]);
    expect(() => generate({ ...r, minUpper: 1, minNumbers: 1 }, rng)).toThrow(
      /Passphrase/,
    );
  });
  it("flags spaces and look-alikes without silently altering secrets", () => {
    const p = "  Opaque1! ";
    expect(manualWarnings(p)).toHaveLength(2);
    expect(p).toBe("  Opaque1! ");
    expect(
      validateSecret("a".repeat(20), DEFAULT_RULES).length,
    ).toBeGreaterThan(0);
  });
});

it("preserves Unicode symbols as whole characters and rejects repeated newlines", () => {
  const r = {
    ...DEFAULT_RULES,
    upper: false,
    lower: false,
    numbers: false,
    symbols: true,
    allowedSymbols: "🔒🛡️",
    length: 8,
    min: 8,
    max: 8,
    minSymbols: 8,
    noRepeat: false,
    ambiguous: false,
  };
  const p = generate(r, rng);
  expect([...p]).toHaveLength(8);
  expect(validateSecret(p, r)).toEqual([]);
  expect(p).not.toMatch(/[\uD800-\uDFFF]/u);
  expect(
    validateSecret("a\n\nb", {
      ...DEFAULT_RULES,
      min: 1,
      minUpper: 0,
      minNumbers: 0,
      minSymbols: 0,
    }),
  ).toContain("Consecutive repeated characters are not allowed.");
});

it("constructs long passwords from two characters without adjacent repetition", () => {
  const r = {
    ...DEFAULT_RULES,
    upper: false,
    lower: true,
    numbers: false,
    symbols: false,
    allowed: "ab",
    length: 128,
    min: 8,
    max: 128,
  };
  const p = generate(r, rng);
  expect(p).toHaveLength(128);
  expect(p).toMatch(/^(ab|ba){64}$/);
  expect(validateSecret(p, r)).toEqual([]);
});
