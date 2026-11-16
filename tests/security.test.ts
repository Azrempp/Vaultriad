import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  derive,
  encrypt,
  decrypt,
  normalizeAnswer,
  createBackup,
  parseBackup,
  verifyBackup,
  parseEnvelope,
} from "../src/main/crypto";
import {
  DEFAULT_PREFERENCES,
  type Vault,
  type Credentials,
  type Factors,
} from "../src/shared/types";
const factors: Factors = {
  password: true,
  pin: true,
  questions: ["pet", "street", "school"],
  bound: false,
};
const credentials: Credentials = {
  password: "a long unique master password",
  pin: "904582",
  answers: ["Mr. Fluffy", "Oak Street", "North High"],
};
const vault: Vault = {
  version: 1,
  entries: [],
  preferences: DEFAULT_PREFERENCES,
  presets: [],
};
describe("authenticated encryption and combined credentials", () => {
  it("normalizes answers without altering passwords or PINs", () => {
    expect(normalizeAnswer("  Mr.   FLUFFY!  ")).toBe("mr fluffy");
    expect(normalizeAnswer("Café / École")).toBe("café école");
  });
  it("round-trips; fresh nonces change ciphertext and tampering fails", async () => {
    const salt = randomBytes(16).toString("hex");
    const key = await derive(credentials, factors, salt);
    try {
      const e = encrypt(vault, key, factors, salt),
        next = encrypt(vault, key, factors, salt);
      expect(decrypt(e, key)).toEqual(vault);
      expect(e.nonce).not.toBe(next.nonce);
      expect(e.data).not.toBe(next.data);
      expect(() =>
        decrypt(
          { ...e, data: Buffer.from("tampered").toString("base64") },
          key,
        ),
      ).toThrow();
      expect(() =>
        decrypt({ ...e, factors: { ...factors, pin: false } }, key),
      ).toThrow();
      expect(() => decrypt({ ...e, tag: "00".repeat(16) }, key)).toThrow();
      expect(() =>
        parseEnvelope(JSON.stringify({ ...e, version: 2 })),
      ).toThrow();
    } finally {
      key.fill(0);
    }
  });
  it("every wrong or missing factor fails and normalized answers succeed", async () => {
    const salt = randomBytes(16).toString("hex"),
      key = await derive(credentials, factors, salt),
      e = encrypt(vault, key, factors, salt);
    key.fill(0);
    for (const c of [
      { ...credentials, password: "" },
      { ...credentials, pin: "" },
      { ...credentials, answers: [] },
      { ...credentials, password: "wrong" },
      { ...credentials, pin: "000000" },
      { ...credentials, answers: ["wrong", ...credentials.answers.slice(1)] },
    ]) {
      const wrong = await derive(c, factors, salt);
      try {
        expect(() => decrypt(e, wrong)).toThrow();
      } finally {
        wrong.fill(0);
      }
    }
    const normalized = await derive(
      {
        ...credentials,
        answers: [
          " mr fluffy ",
          " OAK   STREET!",
          "north-high".replace("-", " "),
        ],
      },
      factors,
      salt,
    );
    try {
      expect(decrypt(e, normalized)).toEqual(vault);
    } finally {
      normalized.fill(0);
    }
  });
  it("bound vaults require the original install secret", async () => {
    const f = { ...factors, bound: true },
      salt = randomBytes(16).toString("hex"),
      binding = randomBytes(32);
    await expect(derive(credentials, f, salt)).rejects.toThrow();
    const key = await derive(credentials, f, salt, binding),
      e = encrypt(vault, key, f, salt);
    const wrong = await derive(credentials, f, salt, randomBytes(32));
    expect(() => decrypt(e, wrong)).toThrow();
    key.fill(0);
    wrong.fill(0);
    binding.fill(0);
  });
  it("backup restore authenticates its complete payload; wrong MAC fails", async () => {
    const salt = randomBytes(16).toString("hex"),
      key = await derive(credentials, factors, salt),
      e = encrypt(vault, key, factors, salt);
    try {
      const raw = createBackup(e, key),
        b = parseBackup(raw);
      verifyBackup(b, key);
      expect(decrypt(b.envelope, key)).toEqual(vault);
      expect(() =>
        verifyBackup({ ...b, payload: b.payload + " " }, key),
      ).toThrow();
      expect(() => verifyBackup({ ...b, mac: "00".repeat(32) }, key)).toThrow();
      expect(() =>
        parseBackup(raw.replace("VAULTRIAD-BACKUP", "OTHER")),
      ).toThrow();
    } finally {
      key.fill(0);
    }
  });
});
