import { it, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "../src/main/storage";
import {
  createBackup,
  encrypt,
  parseBackup,
  verifyBackup,
  decrypt,
} from "../src/main/crypto";
import { DEFAULT_PREFERENCES, type Vault } from "../src/shared/types";
import { randomBytes } from "node:crypto";
it("atomic encrypted writes retain exactly one rolling copy; reset backup remains intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vaultriad-test-"));
  const path = join(dir, "vault"),
    backup = join(dir, "reset.vtbackup"),
    key = randomBytes(32),
    salt = randomBytes(16).toString("hex");
  const v: Vault = {
    version: 1,
    entries: [],
    presets: [],
    preferences: DEFAULT_PREFERENCES,
  };
  const seal = () =>
    createBackup(
      encrypt(
        v,
        key,
        { password: true, pin: false, questions: [], bound: false },
        salt,
      ),
      key,
    );
  try {
    const first = seal();
    await atomicWrite(path, first, true);
    const second = seal();
    await atomicWrite(path, second, true);
    expect(await readFile(path + ".previous", "utf8")).toBe(first);
    expect(await readFile(path, "utf8")).toBe(second);
    expect((await readdir(dir)).some((f) => f.endsWith(".tmp"))).toBe(false);
    await atomicWrite(backup, await readFile(path));
    await unlink(path);
    expect(await readFile(backup, "utf8")).toBe(second);
    const b = parseBackup(await readFile(backup, "utf8"));
    verifyBackup(b, key);
    expect(decrypt(b.envelope, key)).toEqual(v);
  } finally {
    key.fill(0);
    await rm(dir, { recursive: true, force: true });
  }
});
