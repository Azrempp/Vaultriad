import {
  app,
  clipboard,
  dialog,
  safeStorage,
  systemPreferences,
} from "electron";
import { promises as fs, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { randomBytes, randomUUID, randomInt, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Credentials,
  Factors,
  Vault,
  Entry,
  PublicStatus,
  ImportPreview,
} from "../shared/types";
import { DEFAULT_PREFERENCES, preset } from "../shared/types";
import { generate, validateSecret, manualWarnings } from "../shared/rules";
import { command } from "./schema";
import {
  derive,
  encrypt,
  decrypt,
  validateFactors,
  createBackup,
  parseBackup,
  verifyBackup,
  type Envelope,
} from "./crypto";
import { atomicWrite, readLimited } from "./storage";
import { stageSecret, resolvePending } from "./entries";
import { parseImport } from "./import";
export class VaultService {
  private epoch = 0;
  private operation = new AsyncLocalStorage<number>();
  private assertActive() {
    if (
      this.operation.getStore() !== undefined &&
      this.operation.getStore() !== this.epoch
    )
      throw Error("Vault locked during the operation.");
  }
  private vault: Vault | null = null;
  private key: Buffer | null = null;
  private envelope: Envelope | null = null;
  private failures = 0;
  private retryAt = 0;
  private activeAt = Date.now();
  private copied: string | null = null;
  private clipboardQueue: Promise<void> = Promise.resolve();
  private clipboardTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRestore: ReturnType<typeof parseBackup> | null = null;
  private importSession: {
    raw: string;
    path: string;
    preview: ImportPreview;
  } | null = null;
  readonly path = join(app.getPath("userData"), "vault.vtriad");
  private bindingPath = join(app.getPath("userData"), "binding.os");
  private quickPath = join(app.getPath("userData"), "quick-unlock.os");
  private backupDirectory = join(app.getPath("documents"), "Vaultriad Backups");
  constructor(private onLock: () => void) {}
  async init() {
    try {
      const config = JSON.parse(
        await readLimited(join(app.getPath("userData"), "settings.json")),
      );
      if (typeof config.backupDirectory === "string")
        this.backupDirectory = config.backupDirectory;
    } catch {}
    try {
      this.envelope = parseBackup(await readLimited(this.path)).envelope;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error(
          "The vault could not be read. Preserve vault.vtriad and vault.vtriad.previous; restore an encrypted backup to recover.",
        );
    }
  }
  status(): PublicStatus {
    return {
      exists: !!this.envelope,
      unlocked: !!this.vault,
      factors: this.envelope?.factors ?? null,
      retryAt: this.retryAt,
      quickUnlock:
        process.platform === "darwin" &&
        systemPreferences.canPromptTouchID() &&
        existsSync(this.quickPath),
      preferences: {
        theme: this.vault?.preferences.theme ?? "dark",
        reducedMotion: this.vault?.preferences.reducedMotion ?? false,
      },
    };
  }
  tick() {
    if (
      this.vault &&
      Date.now() - this.activeAt >
        this.vault.preferences.autoLockMinutes * 60000
    )
      this.lock();
  }
  lock() {
    this.epoch++;
    this.key?.fill(0);
    this.key = null;
    this.vault = null;
    this.importSession = null;
    this.pendingRestore = null;
    void this.clearClipboard().catch(() => {});
    this.onLock();
  }
  private clearClipboard() {
    if (this.clipboardTimer) clearTimeout(this.clipboardTimer);
    this.clipboardQueue = this.clipboardQueue
      .catch(() => {})
      .then(async () => {
        const copied = this.copied;
        this.copied = null;
        if (copied !== null && (await clipboard.readText()) === copied)
          clipboard.clear();
      });
    return this.clipboardQueue;
  }
  private async binding(create = false) {
    if (
      !safeStorage.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw Error("A secure OS keychain is required for computer binding.");
    let stored: Buffer;
    try {
      stored = await fs.readFile(this.bindingPath);
    } catch (e) {
      if (!create || (e as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("The original computer binding is unavailable.");
      this.assertActive();
      const value = randomBytes(32);
      await atomicWrite(
        this.bindingPath,
        safeStorage.encryptString(value.toString("base64")),
      );
      return value;
    }
    try {
      return Buffer.from(safeStorage.decryptString(stored), "base64");
    } catch {
      throw Error("The original computer binding cannot be decrypted.");
    }
  }
  private async keyFor(c: Credentials, e: Envelope) {
    const binding = e.factors.bound ? await this.binding() : undefined;
    try {
      return await derive(c, e.factors, e.salt, binding);
    } finally {
      binding?.fill(0);
    }
  }
  private async newKey(c: Credentials, f: Factors, salt: string) {
    validateFactors(f, c);
    const binding = f.bound ? await this.binding(true) : undefined;
    try {
      return await derive(c, f, salt, binding);
    } finally {
      binding?.fill(0);
    }
  }
  private async persist(
    v: Vault = this.vault!,
    key: Buffer = this.key!,
    f = this.envelope!.factors,
    salt = this.envelope!.salt,
  ) {
    this.assertActive();
    if (Buffer.byteLength(JSON.stringify(v)) > 46 * 1024 * 1024)
      throw Error(
        "Vault exceeds its 46 MB plaintext capacity. No changes were written.",
      );
    const next = encrypt(v, key, f, salt);
    await atomicWrite(this.path, createBackup(next, key), true);
    this.assertActive();
    this.envelope = next;
    this.vault = v;
  }
  private requireVault() {
    if (!this.vault || !this.key) throw Error("Your vault is locked.");
    return this.vault;
  }
  private entry(id: string) {
    const e = this.requireVault().entries.find((e) => e.id === id);
    if (!e) throw Error("Entry not found.");
    return e;
  }
  private async updateEntry(entry: Entry) {
    const v = this.requireVault();
    await this.persist({
      ...v,
      entries: v.entries.map((e) => (e.id === entry.id ? entry : e)),
    });
  }
  private throttle() {
    if (Date.now() < this.retryAt)
      throw Error(
        `Please wait ${Math.ceil((this.retryAt - Date.now()) / 1000)} seconds before trying again.`,
      );
  }
  private failed() {
    this.retryAt =
      Date.now() + Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5));
  }
  private async backup() {
    if (!this.envelope) throw Error("No vault to back up.");
    await fs.mkdir(this.backupDirectory, { recursive: true, mode: 0o700 });
    const path = join(
      this.backupDirectory,
      `Vaultriad-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.vtbackup`,
    );
    // Locked reset copies the existing encrypted, MAC-protected file without decrypting it.
    const raw = await this.readEncryptedBackup();
    await atomicWrite(path, raw);
    return path;
  }
  private async readEncryptedBackup() {
    return readLimited(this.path);
  }
  async execute(input: unknown): Promise<unknown> {
    return this.operation.run(this.epoch, () => this.dispatch(input));
  }
  private async dispatch(input: unknown): Promise<unknown> {
    const c = command.parse(input);
    if (c.type === "status") return this.status();
    if (c.type === "about") {
      await dialog.showMessageBox({
        type: "info",
        title: "About Vaultriad",
        message: "Vaultriad",
        detail:
          "Version 1.0.0 · Local-first encrypted password manager\nAES-256-GCM · Argon2id\nA compromised OS can access unlocked secrets.",
      });
      return;
    }
    if (c.type === "lock") {
      this.lock();
      return this.status();
    }
    if (c.type === "activity") {
      if (this.vault) this.activeAt = Date.now();
      return;
    }
    if (c.type === "chooseBackupDirectory") {
      const result = await dialog.showOpenDialog({
        title: "Choose Vaultriad backup folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (!result.canceled) {
        this.backupDirectory = result.filePaths[0];
        await atomicWrite(
          join(app.getPath("userData"), "settings.json"),
          JSON.stringify({ backupDirectory: this.backupDirectory }),
        );
        this.assertActive();
        if (this.vault)
          await this.persist({
            ...this.vault,
            preferences: {
              ...this.vault.preferences,
              backupDirectory: this.backupDirectory,
            },
          });
      }
      return this.backupDirectory;
    }
    if (c.type === "setup") {
      if (this.envelope) throw Error("A vault already exists.");
      const salt = randomBytes(16).toString("hex");
      const key = await this.newKey(c.credentials, c.factors, salt);
      const vault: Vault = {
        version: 1,
        entries: [],
        presets: [],
        preferences: {
          ...DEFAULT_PREFERENCES,
          ...c.preferences,
          backupDirectory: this.backupDirectory,
        },
      };
      try {
        await this.persist(vault, key, c.factors, salt);
        this.key = key;
      } catch (e) {
        key.fill(0);
        this.lock();
        throw e;
      }
      this.activeAt = Date.now();
      return this.vault;
    }
    if (c.type === "unlock") {
      this.throttle();
      const stored = parseBackup(await readLimited(this.path));
      this.envelope = stored.envelope;
      this.assertActive();
      if (!this.envelope) throw Error("Create a vault first.");
      let key: Buffer | undefined;
      try {
        key = await this.keyFor(c.credentials, this.envelope);
        verifyBackup(stored, key);
        const vault = decrypt(this.envelope, key);
        this.assertActive();
        this.key = key;
        this.vault = vault;
        this.backupDirectory =
          vault.preferences.backupDirectory || this.backupDirectory;
        this.failures = 0;
        this.retryAt = 0;
        this.activeAt = Date.now();
        return vault;
      } catch {
        key?.fill(0);
        this.key = null;
        this.vault = null;
        this.failed();
        throw Error(
          "Unable to unlock. Check your credentials or restore an intact backup.",
        );
      }
    }
    if (c.type === "reset") {
      if (!this.envelope) throw Error("No vault to reset.");
      const path = await this.backup();
      await fs.unlink(this.path);
      await fs.unlink(this.path + ".previous").catch(() => {});
      await fs.unlink(this.quickPath).catch(() => {});
      this.lock();
      this.envelope = null;
      return { path };
    }
    if (c.type === "inspectBackup") {
      const r = await dialog.showOpenDialog({
        title: "Restore encrypted Vaultriad backup",
        filters: [
          { name: "Vaultriad encrypted backup", extensions: ["vtbackup"] },
        ],
        properties: ["openFile"],
      });
      if (r.canceled) return null;
      this.pendingRestore = parseBackup(await readLimited(r.filePaths[0]));
      return {
        factors: this.pendingRestore.envelope.factors,
        name: basename(r.filePaths[0]),
      };
    }
    if (c.type === "restore") {
      this.throttle();
      if (!this.pendingRestore) throw Error("Select a backup first.");
      if (this.envelope)
        throw Error("Reset your existing vault before restoring.");
      let key: Buffer | undefined;
      try {
        key = await this.keyFor(c.credentials, this.pendingRestore.envelope);
        verifyBackup(this.pendingRestore, key);
        const vault = decrypt(this.pendingRestore.envelope, key);
        await this.persist(
          vault,
          key,
          this.pendingRestore.envelope.factors,
          this.pendingRestore.envelope.salt,
        );
        this.key = key;
        this.pendingRestore = null;
        this.failures = 0;
        this.retryAt = 0;
        this.activeAt = Date.now();
        return vault;
      } catch {
        key?.fill(0);
        this.failed();
        throw Error(
          "Backup integrity or credential check failed. Check the original credentials and computer binding.",
        );
      }
    }
    if (c.type === "quickUnlock") {
      this.throttle();
      if (!this.envelope) throw Error("No vault.");
      if (
        process.platform !== "darwin" ||
        !systemPreferences.canPromptTouchID()
      )
        throw Error("Biometric unlock requires Touch ID on macOS.");
      try {
        await systemPreferences.promptTouchID("unlock Vaultriad");
        const wrapped = JSON.parse(
          safeStorage.decryptString(await fs.readFile(this.quickPath)),
        );
        if (wrapped.salt !== this.envelope.salt)
          throw Error("Credentials changed.");
        const key = Buffer.from(wrapped.key, "base64");
        try {
          const stored = parseBackup(await readLimited(this.path));
          verifyBackup(stored, key);
          this.envelope = stored.envelope;
          const vault = decrypt(this.envelope, key);
          this.assertActive();
          this.key = key;
          this.vault = vault;
          this.activeAt = Date.now();
          this.failures = 0;
          this.retryAt = 0;
          this.backupDirectory = vault.preferences.backupDirectory;
          return vault;
        } catch (e) {
          key.fill(0);
          throw e;
        }
      } catch {
        this.failed();
        throw Error(
          "Biometric unlock unavailable or cancelled. Use your credentials.",
        );
      }
    }
    const v = this.requireVault();
    if (c.type === "snapshot") return v;
    if (c.type === "saveEntry") {
      const now = new Date().toISOString();
      const old = c.entry.id ? this.entry(c.entry.id) : null;
      const e: Entry = {
        ...(old || {
          id: randomUUID(),
          createdAt: now,
          rotatedAt: now,
          current: "",
          past: [],
          pending: null,
        }),
        ...c.entry,
        id: old?.id ?? randomUUID(),
        updatedAt: now,
      };
      await this.persist({
        ...v,
        entries: old
          ? v.entries.map((x) => (x.id === e.id ? e : x))
          : [...v.entries, e],
      });
    } else if (c.type === "deleteEntry")
      await this.persist({
        ...v,
        entries: v.entries.filter((e) => e.id !== c.id),
      });
    else if (c.type === "stage") {
      if (c.value !== c.confirm) throw Error("The secrets do not match.");
      const e = this.entry(c.id);
      const warnings = [
        ...validateSecret(c.value, e.rules),
        ...manualWarnings(c.value),
      ];
      if (warnings.length && !c.acceptWarnings) throw Error(warnings.join(" "));
      await this.updateEntry(stageSecret(e, c.value));
    } else if (c.type === "resolve")
      await this.updateEntry(resolvePending(this.entry(c.id), c.worked));
    else if (c.type === "deletePast") {
      const e = this.entry(c.id);
      await this.updateEntry({
        ...e,
        past: e.past.filter((p) => p.id !== c.pastId),
        updatedAt: new Date().toISOString(),
      });
    } else if (c.type === "generate")
      return generate(c.rules, (max) => randomInt(max));
    else if (c.type === "copy") {
      const e = this.entry(c.id);
      const value =
        c.source === "current"
          ? e.current
          : c.source === "pending"
            ? e.pending?.value
            : e.past.find((p) => p.id === c.pastId)?.value;
      if (!value) throw Error("No secret to copy.");
      await this.clearClipboard();
      this.assertActive();
      this.clipboardQueue = this.clipboardQueue.then(async () => {
        this.assertActive();
        await clipboard.writeText(value);
        this.copied = value;
      });
      await this.clipboardQueue;
      this.assertActive();
      this.clipboardTimer = setTimeout(
        () => void this.clearClipboard().catch(() => {}),
        v.preferences.clipboardSeconds * 1000,
      );
      return;
    } else if (c.type === "preferences")
      await this.persist({
        ...v,
        preferences: { ...v.preferences, ...c.preferences },
      });
    else if (c.type === "backup") {
      const path = await this.backup();
      await this.persist({
        ...v,
        preferences: {
          ...v.preferences,
          lastBackupAt: new Date().toISOString(),
        },
      });
      return { path };
    } else if (c.type === "portableExport") {
      const r = await dialog.showSaveDialog({
        title: "Export portable encrypted backup",
        defaultPath: "Vaultriad-portable.vtbackup",
        filters: [
          { name: "Encrypted Vaultriad backup", extensions: ["vtbackup"] },
        ],
      });
      if (r.canceled || !r.filePath) return null;
      const factors: Factors = {
        password: true,
        pin: false,
        questions: [],
        bound: false,
      };
      const salt = randomBytes(16).toString("hex"),
        key = await derive(
          { password: c.passphrase, pin: "", answers: [] },
          factors,
          salt,
        );
      try {
        await atomicWrite(
          r.filePath,
          createBackup(encrypt(v, key, factors, salt), key),
        );
        return { path: r.filePath };
      } finally {
        key.fill(0);
      }
    } else if (c.type === "changeCredentials") {
      this.throttle();
      let old: Buffer | undefined;
      try {
        old = await this.keyFor(c.original, this.envelope!);
        decrypt(this.envelope!, old);
      } catch {
        this.failed();
        throw Error("Original credentials are incorrect.");
      } finally {
        old?.fill(0);
      }
      const salt = randomBytes(16).toString("hex"),
        key = await this.newKey(c.credentials, c.factors, salt);
      try {
        await this.persist(v, key, c.factors, salt);
        this.key?.fill(0);
        this.key = key;
        await fs.unlink(this.quickPath).catch(() => {});
      } catch (e) {
        if (this.key !== key) key.fill(0);
        throw e;
      }
    } else if (c.type === "enableQuickUnlock") {
      if (
        process.platform !== "darwin" ||
        !systemPreferences.canPromptTouchID() ||
        !safeStorage.isEncryptionAvailable()
      )
        throw Error("Touch ID and an OS keychain are required.");
      this.throttle();
      let key: Buffer | undefined;
      try {
        key = await this.keyFor(c.credentials, this.envelope!);
        decrypt(this.envelope!, key);
        await systemPreferences.promptTouchID(
          "enable Vaultriad biometric unlock",
        );
        await atomicWrite(
          this.quickPath,
          safeStorage.encryptString(
            JSON.stringify({
              salt: this.envelope!.salt,
              key: key.toString("base64"),
            }),
          ),
        );
      } catch {
        this.failed();
        throw Error("Credentials or biometric verification failed.");
      } finally {
        key?.fill(0);
      }
    } else if (c.type === "disableQuickUnlock") {
      await fs.unlink(this.quickPath).catch(() => {});
      return;
    } else if (c.type === "savePreset") {
      await this.persist({
        ...v,
        presets: [
          ...v.presets.filter((p) => p.name !== c.name),
          { name: c.name, rules: c.rules },
        ].slice(-50),
      });
    } else if (c.type === "importPreview") {
      const r = await dialog.showOpenDialog({
        title: "Import passwords — source file is plaintext",
        filters: [
          { name: "Password exports", extensions: ["csv", "json", "1pux"] },
        ],
        properties: ["openFile"],
      });
      if (r.canceled) return null;
      const path = r.filePaths[0];
      if (path.endsWith(".1pux"))
        throw Error(
          "Export 1Password as CSV or uncompressed JSON; compressed .1pux archives are not supported.",
        );
      const raw = await readLimited(path),
        parsed = parseImport(raw);
      const preview: ImportPreview = {
        ...parsed,
        token: randomUUID(),
        pathLabel: basename(path),
      };
      this.markDuplicates(preview);
      this.importSession = { raw, path, preview };
      return {
        ...preview,
        rows: preview.rows.map(({ secret, ...row }) => ({
          ...row,
          secret: "",
        })),
      };
    } else if (c.type === "importRemap") {
      const s = this.importSession;
      if (!s || s.preview.token !== c.token)
        throw Error("Import expired. Select the file again.");
      s.preview = {
        ...parseImport(s.raw, c.mapping),
        token: c.token,
        pathLabel: basename(s.path),
      };
      this.markDuplicates(s.preview);
      return {
        ...s.preview,
        rows: s.preview.rows.map(({ secret, ...row }) => ({
          ...row,
          secret: "",
        })),
      };
    } else if (c.type === "importCommit") {
      const s = this.importSession;
      if (!s || s.preview.token !== c.token) throw Error("Import expired.");
      if (
        c.rows.length !== s.preview.rows.length ||
        new Set(c.rows.map((r) => r.id)).size !== c.rows.length
      )
        throw Error("Review every import row.");
      const entries = structuredClone(v.entries);
      let imported = 0,
        skipped = 0,
        duplicates = 0;
      const unmapped = new Set<string>();
      for (const choice of c.rows) {
        const row = s.preview.rows.find((r) => r.id === choice.id);
        if (!row) throw Error("Invalid import row.");
        row.unmapped.forEach((h) => unmapped.add(h));
        if (choice.skip) {
          skipped++;
          continue;
        }
        if (choice.category === "unsorted")
          throw Error("Assign a category to all included rows.");
        if (!row.secret) throw Error("Map a password field or skip the row.");
        const duplicate = entries.find(
          (e) =>
            e.name.toLowerCase() === row.name.toLowerCase() &&
            e.username.toLowerCase() === row.username.toLowerCase(),
        );
        const now = new Date().toISOString();
        if (duplicate) {
          duplicates++;
          if (
            duplicate.current === row.secret ||
            choice.resolution === "keep"
          ) {
            skipped++;
            continue;
          }
          if (choice.resolution === "replace") {
            if (duplicate.pending)
              throw Error(
                `Resolve Pending for ${duplicate.name} before replacing it.`,
              );
            duplicate.past = duplicate.current
              ? [
                  {
                    id: randomUUID(),
                    value: duplicate.current,
                    replacedAt: now,
                  },
                  ...duplicate.past,
                ]
              : duplicate.past;
            duplicate.current = row.secret;
            duplicate.updatedAt = now;
            duplicate.rotatedAt = now;
            imported++;
            continue;
          }
        }
        entries.push({
          id: randomUUID(),
          name: row.name,
          username: row.username,
          location: row.location,
          notes: row.notes,
          tags: ["imported"],
          category: choice.category,
          createdAt: now,
          updatedAt: now,
          rotatedAt: now,
          rotationDays: 90,
          rules: preset(choice.category),
          current: row.secret,
          past: [],
          pending: null,
        });
        imported++;
      }
      await this.persist({ ...v, entries });
      s.raw = "";
      s.preview.rows = [];
      return { imported, skipped, duplicates, unmapped: [...unmapped] };
    } else if (c.type === "deleteImportSource") {
      const s = this.importSession;
      if (!s || s.preview.token !== c.token) throw Error("Import expired.");
      const h = await fs.open(s.path, "r+");
      try {
        const { size } = await h.stat();
        const block = Buffer.alloc(65536);
        for (let offset = 0; offset < size; offset += block.length)
          await h.write(
            block,
            0,
            Math.min(block.length, size - offset),
            offset,
          );
        await h.sync();
      } finally {
        await h.close();
      }
      await fs.unlink(s.path);
      this.importSession = null;
      return;
    } else if (c.type === "breach") {
      if (!v.preferences.breachEnabled)
        throw Error("Enable the optional breach check in Settings first.");
      const secret = this.entry(c.id).current;
      if (!secret) throw Error("No Current secret.");
      const hash = createHash("sha1")
        .update(secret)
        .digest("hex")
        .toUpperCase();
      const response = await fetch(
        `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
        {
          headers: { "Add-Padding": "true" },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (!response.ok) throw Error("The breach service is unavailable.");
      const data = await response.text();
      const line = data
        .split("\n")
        .find((l) => l.startsWith(hash.slice(5) + ":"));
      return { count: line ? Number(line.split(":")[1].trim()) : 0 };
    } else throw Error("Unsupported request.");
    return this.vault;
  }
  private markDuplicates(preview: ImportPreview) {
    const seen = new Map<string, string>();
    for (const row of preview.rows) {
      const identity = JSON.stringify([
        row.name.toLowerCase(),
        row.username.toLowerCase(),
      ]);
      const e = this.vault?.entries.find(
        (e) =>
          e.name.toLowerCase() === row.name.toLowerCase() &&
          e.username.toLowerCase() === row.username.toLowerCase(),
      );
      if (e) {
        row.duplicateId = e.id;
        if (e.current === row.secret) row.skip = true;
      } else if (seen.has(identity)) row.duplicateId = seen.get(identity);
      seen.set(identity, row.id);
    }
  }
}
