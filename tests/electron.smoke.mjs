import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const temporary = await mkdtemp(join(tmpdir(), "vaultriad-electron-"));
const executablePath = process.env.VAULTRIAD_TEST_EXECUTABLE;
const args = executablePath ? [] : [resolve(".")];
// Restricted containers cannot install a setuid helper. Never used by npm run dev/dist.
if (process.env.VAULTRIAD_TEST_NO_SANDBOX === "1")
  args.unshift("--no-sandbox", "--disable-gpu");
let app;
try {
  app = await electron.launch({
    executablePath,
    args,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: temporary,
      XDG_CACHE_HOME: join(temporary, "cache"),
    },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "Make it yours." }).waitFor();
  await mkdir("work/screenshots", { recursive: true });
  await page.screenshot({ path: "work/screenshots/setup.png" });
  await page
    .getByLabel("Master password", { exact: true })
    .fill("a unique desktop smoke password!");
  await page
    .getByLabel("Confirm master password", { exact: true })
    .fill("a unique desktop smoke password!");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("heading", { name: "A little peace of mind." })
    .waitFor();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, temporary);
  await page
    .getByRole("button", { name: "Choose folder", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create my vault" }).click();
  await page
    .getByRole("heading", { name: "All entries", exact: true })
    .waitFor();
  await page.screenshot({ path: "work/screenshots/empty-vault.png" });
  await page
    .getByRole("button", { name: "Add entry", exact: false })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Smoke test account");
  await page
    .getByRole("dialog")
    .getByLabel("Username / identifier")
    .fill("alice@example.test");
  await page.getByRole("button", { name: "Create entry", exact: true }).click();
  await page
    .getByRole("button", { name: "Generate a secret", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save as Pending", exact: true })
    .click();
  await page
    .getByText("New secret waiting for confirmation", { exact: true })
    .waitFor();
  const snapshot = await page.evaluate(() =>
    window.vault.request({ type: "snapshot" }),
  );
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.entries[0].current, "");
  assert.ok(snapshot.data.entries[0].pending.value.length >= 16);
  const secret = snapshot.data.entries[0].pending.value;
  await page
    .getByRole("button", { name: "It worked, make it Current", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reveal secret", exact: true })
    .click();
  await page.getByText(secret, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Hide secret", exact: true }).click();
  assert.equal(await page.getByText(secret, { exact: true }).count(), 0);
  await page.screenshot({ path: "work/screenshots/entry.png" });
  await page.getByRole("button", { name: /^New secret/ }).click();
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  const multiline = "  synthetic SSH secret\nsecond line preserved  ";
  await page.getByLabel("New secret", { exact: true }).fill(multiline);
  await page.getByLabel("Type it again", { exact: true }).fill(multiline);
  await page
    .getByLabel("I understand; preserve exactly what I entered.")
    .check();
  await page
    .getByRole("button", { name: "Save as Pending", exact: true })
    .click();
  await page
    .getByText("New secret waiting for confirmation", { exact: true })
    .waitFor();
  const staged = await page.evaluate(() =>
    window.vault.request({ type: "snapshot" }),
  );
  assert.equal(staged.data.entries[0].current, secret);
  assert.equal(staged.data.entries[0].pending.value, multiline);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page
    .getByText("New secret waiting for confirmation", { exact: true })
    .waitFor({ state: "detached" });
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.sandbox, true);
  if (executablePath) {
    const opened = await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.openDevTools({ mode: "detach" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return wc.isDevToolsOpened();
    });
    assert.equal(opened, false);
  }
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await page
    .getByRole("button", { name: "Lock vault", exact: false })
    .first()
    .click();
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  assert.equal(
    await page.getByText("Smoke test account", { exact: true }).count(),
    0,
  );
  await page
    .getByLabel("Master password", { exact: true })
    .fill("a unique desktop smoke password!");
  await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
  await page
    .getByRole("heading", { name: "All entries", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Lock vault", exact: false })
    .first()
    .click();
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await page
    .getByRole("button", { name: "Reset and start over", exact: true })
    .click();
  await page.getByLabel("Type RESET to continue").fill("RESET");
  await page
    .getByRole("button", { name: "Back up and reset vault", exact: true })
    .click();
  await page.getByRole("heading", { name: "Make it yours." }).waitFor();
  const backups = (await readdir(temporary)).filter((f) =>
    f.endsWith(".vtbackup"),
  );
  assert.equal(backups.length, 1);
  const backup = join(temporary, backups[0]);
  assert.equal((await readFile(backup, "utf8")).includes(secret), false);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, backup);
  await page.getByRole("button", { name: /Already have a vault/ }).click();
  await page.getByRole("heading", { name: "Restore your vault" }).waitFor();
  await page
    .getByLabel("Master password", { exact: true })
    .fill("a unique desktop smoke password!");
  await page
    .getByRole("button", { name: "Restore vault", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "All entries", exact: true })
    .waitFor();
  const restored = await page.evaluate(() =>
    window.vault.request({ type: "snapshot" }),
  );
  assert.equal(restored.data.entries[0].current, secret);
  assert.deepEqual(errors, []);
  console.log(
    "Electron smoke passed: setup, entry, generation, Pending → Current, reveal/hide, multiline Pending/discard, lock/unlock, reset/restore, bridge isolation.",
  );
} finally {
  if (app) await app.close();
  await rm(temporary, { recursive: true, force: true });
}
