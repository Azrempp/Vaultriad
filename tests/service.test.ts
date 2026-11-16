import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const os = vi.hoisted(() => ({
  root: "",
  clipboard: "",
  openFile: "",
  saveFile: "",
  encryption: false,
  touchID: false,
  cancelBiometric: false,
  biometricPrompts: 0,
  onBiometricPrompt: null as (() => void) | null,
}));
vi.mock("electron", () => ({
  app: { getPath: (kind: string) => join(os.root, kind) },
  clipboard: {
    readText: async () => os.clipboard,
    writeText: async (v: string) => {
      os.clipboard = v;
    },
    clear: () => {
      os.clipboard = "";
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => os.encryption,
    // Mock OS wrapping only; production uses Electron safeStorage.
    encryptString: (value: string) => Buffer.from("test-wrapped:" + value),
    decryptString: (value: Buffer) =>
      value.toString().slice("test-wrapped:".length),
    getSelectedStorageBackend: () => "basic_text",
  },
  systemPreferences: {
    canPromptTouchID: () => os.touchID,
    promptTouchID: async () => {
      os.biometricPrompts++;
      os.onBiometricPrompt?.();
      if (os.cancelBiometric) throw Error("Cancelled");
    },
  },
  dialog: {
    showOpenDialog: async () => ({
      canceled: !os.openFile,
      filePaths: [os.openFile],
    }),
    showSaveDialog: async () => ({
      canceled: !os.saveFile,
      filePath: os.saveFile,
    }),
    showMessageBox: async () => ({ response: 0 }),
  },
}));
import { VaultService } from "../src/main/service";
import {
  DEFAULT_PREFERENCES,
  preset,
  type Vault,
  type Entry,
} from "../src/shared/types";
const factors = { password: true, pin: true, questions: [], bound: false },
  credentials = {
    password: "a unique test master password",
    pin: "184952",
    answers: [],
  };
const {
  advanced,
  theme,
  reducedMotion,
  autoLockMinutes,
  clipboardSeconds,
  rotationReminders,
  breachEnabled,
} = DEFAULT_PREFERENCES;
const preferences = {
  advanced,
  theme,
  reducedMotion,
  autoLockMinutes,
  clipboardSeconds,
  rotationReminders,
  breachEnabled,
};
let service: VaultService;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vaultriad-service-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  os.root = await mkdtemp(join(root, "case-"));
  os.clipboard = "";
  os.openFile = "";
  os.saveFile = "";
  os.encryption = false;
  os.touchID = false;
  os.cancelBiometric = false;
  os.biometricPrompts = 0;
  os.onBiometricPrompt = null;
  service = new VaultService(() => {});
  await service.init();
});
const setup = () =>
  service.execute({ type: "setup", factors, credentials, preferences });
const add = async (name = "Router") => {
  const v = (await service.execute({
    type: "saveEntry",
    entry: {
      name,
      username: "admin",
      location: "192.168.1.1",
      notes: "private note",
      tags: [],
      category: "hardware",
      rotationDays: 90,
      rules: preset("hardware"),
    },
  })) as Vault;
  return v.entries[v.entries.length - 1];
};
describe("main-process vault lifecycle", () => {
  it("setup, Pending, Current, clipboard, restart, reset and original-credential restore", async () => {
    await setup();
    const e = await add();
    const secret = "Original-working-secret!42";
    await service.execute({
      type: "stage",
      id: e.id,
      value: secret,
      confirm: secret,
      acceptWarnings: true,
    });
    await service.execute({ type: "resolve", id: e.id, worked: true });
    await service.execute({ type: "copy", id: e.id, source: "current" });
    expect(os.clipboard).toBe(secret);
    os.clipboard = "user copied something else";
    service.lock();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(os.clipboard).toBe("user copied something else");
    expect(service.status().unlocked).toBe(false);
    expect(await readFile(service.path, "utf8")).not.toContain(secret);
    expect(await readFile(service.path, "utf8")).not.toContain("private note");
    service = new VaultService(() => {});
    await service.init();
    const unlocked = (await service.execute({
      type: "unlock",
      credentials,
    })) as Vault;
    expect(unlocked.entries[0].current).toBe(secret);
    service.lock();
    const result = (await service.execute({
      type: "reset",
      confirmation: "RESET",
    })) as { path: string };
    const intact = await readFile(result.path, "utf8");
    expect(service.status().exists).toBe(false);
    await expect(readFile(service.path)).rejects.toThrow();
    os.openFile = result.path;
    const info = (await service.execute({ type: "inspectBackup" })) as {
      factors: unknown;
    };
    expect(info.factors).toEqual(factors);
    const restored = (await service.execute({
      type: "restore",
      credentials,
    })) as Vault;
    expect(restored.entries[0].current).toBe(secret);
    expect(await readFile(result.path, "utf8")).toBe(intact);
    service.lock();
  });
  it("validates IPC and refuses mutations while locked", async () => {
    await expect(
      service.execute({
        type: "setup",
        factors: { ...factors, password: false, pin: false },
        credentials,
        preferences,
      }),
    ).rejects.toThrow();
    await setup();
    await expect(
      service.execute({ type: "saveEntry", entry: { name: "x" } }),
    ).rejects.toThrow();
    const e = await add();
    await expect(
      service.execute({
        type: "stage",
        id: e.id,
        value: "one",
        confirm: "two",
        acceptWarnings: true,
      }),
    ).rejects.toThrow(/match/);
    await expect(
      service.execute({ type: "deleteEntry", id: e.id, confirmation: "no" }),
    ).rejects.toThrow();
    service.lock();
    await expect(
      service.execute({ type: "saveEntry", entry: { name: "x" } }),
    ).rejects.toThrow();
    await expect(service.execute({ type: "snapshot" })).rejects.toThrow(
      /locked/,
    );
  });
  it("wrong credentials get a generic error and a retry delay", async () => {
    await setup();
    service.lock();
    await expect(
      service.execute({
        type: "unlock",
        credentials: { ...credentials, pin: "000000" },
      }),
    ).rejects.toThrow("Unable to unlock");
    expect(service.status().retryAt).toBeGreaterThan(Date.now());
    await expect(
      service.execute({ type: "unlock", credentials }),
    ).rejects.toThrow(/wait/);
  });
  it("does not reopen when system lock interrupts derivation", async () => {
    await setup();
    service.lock();
    const unlocking = service.execute({ type: "unlock", credentials });
    setTimeout(() => service.lock(), 30);
    await expect(unlocking).rejects.toThrow();
    expect(service.status().unlocked).toBe(false);
  });
  it("import preview does not leak secrets and commit keeps duplicate history", async () => {
    await setup();
    os.openFile = join(os.root, "export.csv");
    await writeFile(
      os.openFile,
      "name,url,username,password\nExample,https://example.com,alice,original-imported-secret",
    );
    let preview = (await service.execute({ type: "importPreview" })) as any;
    expect(JSON.stringify(preview)).not.toContain("original-imported-secret");
    await service.execute({
      type: "importCommit",
      token: preview.token,
      rows: preview.rows.map((r: any) => ({
        id: r.id,
        category: r.category,
        skip: false,
        resolution: "keep",
      })),
    });
    await writeFile(
      os.openFile,
      "name,url,username,password\nExample,https://example.com,alice,replacement-imported-secret",
    );
    preview = (await service.execute({ type: "importPreview" })) as any;
    expect(preview.rows[0].duplicateId).toBeTruthy();
    const summary = (await service.execute({
      type: "importCommit",
      token: preview.token,
      rows: preview.rows.map((r: any) => ({
        id: r.id,
        category: r.category,
        skip: false,
        resolution: "replace",
      })),
    })) as any;
    expect(summary.imported).toBe(1);
    const v = (await service.execute({ type: "snapshot" })) as Vault;
    expect(v.entries[0].current).toBe("replacement-imported-secret");
    expect(v.entries[0].past[0].value).toBe("original-imported-secret");
    service.lock();
  });
  it("portable backups use a separate password and modified backup cannot restore", async () => {
    await setup();
    await add();
    os.saveFile = join(os.root, "portable.vtbackup");
    await service.execute({
      type: "portableExport",
      passphrase: "a separate portable password",
    });
    const raw = await readFile(os.saveFile, "utf8");
    const parsed = JSON.parse(raw);
    parsed.mac = "00".repeat(32);
    await writeFile(os.saveFile, JSON.stringify(parsed));
    service.lock();
    await service.execute({ type: "reset", confirmation: "RESET" });
    os.openFile = os.saveFile;
    await service.execute({ type: "inspectBackup" });
    await expect(
      service.execute({
        type: "restore",
        credentials: {
          password: "a separate portable password",
          pin: "",
          answers: [],
        },
      }),
    ).rejects.toThrow(/integrity/);
    expect(service.status().unlocked).toBe(false);
  });
});

async function asMac(action: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: "darwin" });
  try {
    await action();
  } finally {
    service.lock();
    Object.defineProperty(process, "platform", original);
  }
}
describe("Touch ID with simulated OS keychain and biometrics", () => {
  it("is opt-in, verifies credentials, unlocks with biometrics, and can be disabled", async () =>
    asMac(async () => {
      os.encryption = true;
      os.touchID = true;
      await setup();
      expect(service.status().quickUnlock).toBe(false);
      await service.execute({ type: "enableQuickUnlock", credentials });
      expect(os.biometricPrompts).toBe(1);
      expect(service.status().quickUnlock).toBe(true);
      service.lock();
      expect(service.status().unlocked).toBe(false);
      const vault = (await service.execute({ type: "quickUnlock" })) as Vault;
      expect(vault.version).toBe(1);
      expect(service.status().unlocked).toBe(true);
      expect(os.biometricPrompts).toBe(2);
      await service.execute({ type: "disableQuickUnlock" });
      expect(service.status().quickUnlock).toBe(false);
    }));
  it("does not wrap a key or prompt for biometrics with wrong original credentials", async () =>
    asMac(async () => {
      os.encryption = true;
      os.touchID = true;
      await setup();
      await expect(
        service.execute({
          type: "enableQuickUnlock",
          credentials: { ...credentials, pin: "000000" },
        }),
      ).rejects.toThrow(/verification/);
      expect(os.biometricPrompts).toBe(0);
      expect(service.status().quickUnlock).toBe(false);
    }));
  it("keeps the vault locked after a cancelled biometric unlock", async () =>
    asMac(async () => {
      os.encryption = true;
      os.touchID = true;
      await setup();
      await service.execute({ type: "enableQuickUnlock", credentials });
      service.lock();
      os.cancelBiometric = true;
      await expect(service.execute({ type: "quickUnlock" })).rejects.toThrow(
        /unavailable or cancelled/,
      );
      expect(service.status().unlocked).toBe(false);
    }));
});

it("does not enable Touch ID if locking interrupts biometric verification", async () =>
  asMac(async () => {
    os.encryption = true;
    os.touchID = true;
    await setup();
    os.onBiometricPrompt = () => service.lock();
    await expect(
      service.execute({ type: "enableQuickUnlock", credentials }),
    ).rejects.toThrow(/verification/);
    expect(service.status().unlocked).toBe(false);
    expect(service.status().quickUnlock).toBe(false);
  }));
