import { z } from "zod";
import { factorSchema } from "./crypto";
export const credentials = z
  .object({
    password: z.string().max(4096),
    pin: z.string().max(12),
    answers: z.array(z.string().max(4096)).max(3),
  })
  .strict();
export const rules = z
  .object({
    min: z.number().int().min(1).max(128),
    max: z.number().int().min(1).max(128),
    length: z.number().int().min(8).max(128),
    upper: z.boolean(),
    lower: z.boolean(),
    numbers: z.boolean(),
    symbols: z.boolean(),
    allowedSymbols: z.string().max(256),
    allowed: z.string().max(512),
    excluded: z.string().max(512),
    ambiguous: z.boolean(),
    minUpper: z.number().int().min(0).max(128),
    minLower: z.number().int().min(0).max(128),
    minNumbers: z.number().int().min(0).max(128),
    minSymbols: z.number().int().min(0).max(128),
    noRepeat: z.boolean(),
    truncates: z.number().int().min(1).max(128).nullable(),
    mode: z.enum(["password", "passphrase"]),
    words: z.number().int().min(3).max(16),
    separator: z.string().max(8),
    capitalize: z.boolean(),
  })
  .strict()
  .refine((r) => r.min <= r.max, "Minimum exceeds maximum.");
const id = z.string().uuid(),
  category = z.enum(["hardware", "domains", "api"]),
  text = z.string().max(20000);
export const entryInput = z
  .object({
    id: id.optional(),
    name: z.string().min(1).max(200),
    username: z.string().max(1000),
    location: z.string().max(2000),
    notes: text,
    tags: z.array(z.string().max(80)).max(30),
    category,
    rotationDays: z.number().int().min(1).max(3650).nullable(),
    rules,
  })
  .strict();
const preferences = z
  .object({
    advanced: z.boolean(),
    theme: z.enum(["dark", "light", "system"]),
    reducedMotion: z.boolean(),
    autoLockMinutes: z.number().int().min(1).max(120),
    clipboardSeconds: z.number().int().min(5).max(120),
    rotationReminders: z.boolean(),
    breachEnabled: z.boolean(),
  })
  .strict();
export const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status") }),
  z.object({ type: z.literal("snapshot") }),
  z.object({ type: z.literal("activity") }),
  z.object({ type: z.literal("lock") }),
  z.object({
    type: z.literal("setup"),
    factors: factorSchema,
    credentials,
    preferences,
  }),
  z.object({ type: z.literal("unlock"), credentials }),
  z.object({ type: z.literal("saveEntry"), entry: entryInput }),
  z.object({
    type: z.literal("deleteEntry"),
    id,
    confirmation: z.literal("DELETE"),
  }),
  z.object({
    type: z.literal("stage"),
    id,
    value: text,
    confirm: text,
    acceptWarnings: z.boolean(),
  }),
  z.object({ type: z.literal("resolve"), id, worked: z.boolean() }),
  z.object({
    type: z.literal("deletePast"),
    id,
    pastId: id,
    confirmation: z.literal("DELETE"),
  }),
  z.object({ type: z.literal("generate"), rules }),
  z.object({
    type: z.literal("copy"),
    id,
    source: z.enum(["current", "pending", "past"]),
    pastId: id.optional(),
  }),
  z.object({ type: z.literal("preferences"), preferences }),
  z.object({ type: z.literal("chooseBackupDirectory") }),
  z.object({ type: z.literal("backup") }),
  z.object({ type: z.literal("reset"), confirmation: z.literal("RESET") }),
  z.object({ type: z.literal("inspectBackup") }),
  z.object({ type: z.literal("restore"), credentials }),
  z.object({
    type: z.literal("portableExport"),
    passphrase: z.string().min(12).max(4096),
  }),
  z.object({
    type: z.literal("changeCredentials"),
    original: credentials,
    factors: factorSchema,
    credentials,
  }),
  z.object({ type: z.literal("enableQuickUnlock"), credentials }),
  z.object({ type: z.literal("quickUnlock") }),
  z.object({ type: z.literal("disableQuickUnlock") }),
  z.object({ type: z.literal("importPreview") }),
  z.object({
    type: z.literal("importRemap"),
    token: id,
    mapping: z.record(z.string().max(200), z.string().max(200)),
  }),
  z.object({
    type: z.literal("importCommit"),
    token: id,
    rows: z
      .array(
        z
          .object({
            id,
            category: z.enum(["hardware", "domains", "api", "unsorted"]),
            skip: z.boolean(),
            resolution: z.enum(["keep", "replace", "both"]),
          })
          .strict(),
      )
      .max(10000),
  }),
  z.object({
    type: z.literal("deleteImportSource"),
    token: id,
    confirmation: z.literal("DELETE"),
  }),
  z.object({
    type: z.literal("savePreset"),
    name: z.string().min(1).max(60),
    rules,
  }),
  z.object({ type: z.literal("breach"), id }),
  z.object({ type: z.literal("about") }),
]);
