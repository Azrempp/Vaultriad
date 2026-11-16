import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { derive, parseBackup, verifyBackup, decrypt } from "../src/main/crypto";
it.skipIf(!process.env.VAULTRIAD_ANDROID_FIXTURE)(
  "opens an Android-written backup with the desktop crypto",
  async () => {
    const raw = await readFile(process.env.VAULTRIAD_ANDROID_FIXTURE!, "utf8");
    const backup = parseBackup(raw);
    const credentials = {
      password: "portable </script> 🔒 example password",
      pin: "096381",
      answers: [" mr fluffy ", " OAK   STREET! ", "café école"],
    };
    const key = await derive(
      credentials,
      backup.envelope.factors,
      backup.envelope.salt,
    );
    try {
      verifyBackup(backup, key);
      const vault = decrypt(backup.envelope, key);
      expect(vault.entries[0].name).toBe("Desktop fixture");
      expect(vault.entries[0].current).toBe("Synthetic-current-secret!42");
    } finally {
      key.fill(0);
    }
  },
);
