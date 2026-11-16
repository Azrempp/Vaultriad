import { useState } from "react";
import {
  Download,
  FolderOpen,
  Shield,
  KeyRound,
  Fingerprint,
} from "lucide-react";
import type { Vault, Factors, Preferences } from "../../shared/types";
import { Credentials, emptyCredentials, defaultFactors } from "./Credentials";
export function preferenceFields(
  p: Preferences,
  set: (v: Preferences) => void,
) {
  return (
    <>
      <div className="two-col">
        <label>
          Auto-lock after
          <select
            value={p.autoLockMinutes}
            onChange={(e) =>
              set({ ...p, autoLockMinutes: Number(e.target.value) })
            }
          >
            {[1, 2, 5, 10, 15, 30, 60, 120].map((n) => (
              <option value={n} key={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </label>
        <label>
          Clear clipboard after
          <select
            value={p.clipboardSeconds}
            onChange={(e) =>
              set({ ...p, clipboardSeconds: Number(e.target.value) })
            }
          >
            {[5, 15, 30, 60, 120].map((n) => (
              <option value={n} key={n}>
                {n} seconds
              </option>
            ))}
          </select>
        </label>
        <label>
          Appearance
          <select
            value={p.theme}
            onChange={(e) =>
              set({ ...p, theme: e.target.value as Preferences["theme"] })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">Follow system</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={p.advanced}
          onChange={(e) => set({ ...p, advanced: e.target.checked })}
        />
        Advanced view (rules, presets, audit, import)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.rotationReminders}
          onChange={(e) => set({ ...p, rotationReminders: e.target.checked })}
        />
        Show rotation reminders
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.reducedMotion}
          onChange={(e) => set({ ...p, reducedMotion: e.target.checked })}
        />
        Reduce motion
      </label>
    </>
  );
}
export function prefsInput(p: Preferences) {
  const {
    advanced,
    theme,
    reducedMotion,
    autoLockMinutes,
    clipboardSeconds,
    rotationReminders,
    breachEnabled,
  } = p;
  return {
    advanced,
    theme,
    reducedMotion,
    autoLockMinutes,
    clipboardSeconds,
    rotationReminders,
    breachEnabled,
  };
}
export default function Settings({
  vault,
  factors,
  request,
  notify,
}: {
  vault: Vault;
  factors: Factors;
  request: (c: unknown) => Promise<any>;
  notify: (s: string) => void;
}) {
  const [p, setP] = useState(vault.preferences);
  const [tab, setTab] = useState("preferences");
  const [original, setOriginal] = useState(emptyCredentials());
  const [next, setNext] = useState(emptyCredentials());
  const [newFactors, setNewFactors] = useState(defaultFactors());
  const [passphrase, setPassphrase] = useState("");
  return (
    <>
      <div className="tabs">
        {["preferences", "backups", "credentials"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setOriginal(emptyCredentials());
              setNext(emptyCredentials());
              setPassphrase("");
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "preferences" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void request({
              type: "preferences",
              preferences: prefsInput(p),
            }).then(() => notify("Preferences saved."));
          }}
        >
          {preferenceFields(p, setP)}
          <div className="settings-section">
            <h3>
              <Shield size={17} />
              Optional breach check
            </h3>
            <p className="muted small">
              Off by default. When you click Check on an entry, Vaultriad sends
              only the first 5 characters of its SHA-1 hash to Have I Been
              Pwned. Your IP address is visible to that service. This is the
              only network feature.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={p.breachEnabled}
                onChange={(e) => {
                  if (
                    !e.target.checked ||
                    window.confirm(
                      "Allow explicit breach checks to contact api.pwnedpasswords.com with your IP address and a 5-character hash prefix?",
                    )
                  )
                    setP({ ...p, breachEnabled: e.target.checked });
                }}
              />
              Allow manual breach checks
            </label>
          </div>
          <button className="primary full" type="submit">
            Save preferences
          </button>
        </form>
      ) : tab === "backups" ? (
        <>
          <div className="settings-section">
            <h3>
              <FolderOpen size={17} />
              Encrypted backup location
            </h3>
            <p className="muted break">{vault.preferences.backupDirectory}</p>
            <button
              className="secondary"
              onClick={() =>
                void request({ type: "chooseBackupDirectory" }).then(() =>
                  request({ type: "snapshot" }),
                )
              }
            >
              Change folder
            </button>
            <button
              className="primary"
              onClick={() =>
                void request({ type: "backup" }).then((r) =>
                  notify(`Encrypted backup saved: ${r.path}`),
                )
              }
            >
              <Download size={16} />
              Back up now
            </button>
            <p className="notice">
              Keep a copy off this computer. Backups require the credentials
              used when they were created.
              {factors.bound
                ? " Bound backups also need this computer’s original OS keychain."
                : ""}
            </p>
          </div>
          <form
            className="settings-section"
            onSubmit={(e) => {
              e.preventDefault();
              void request({ type: "portableExport", passphrase }).then((r) => {
                if (r) {
                  setPassphrase("");
                  notify(`Portable backup saved: ${r.path}`);
                }
              });
            }}
          >
            <h3>Portable encrypted export</h3>
            <p className="muted small">
              Uses a separate passphrase and no computer binding. Store this
              passphrase safely.
            </p>
            <label>
              Export passphrase (12+ characters)
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
            <button className="secondary" type="submit">
              Export portable backup
            </button>
          </form>
        </>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void request({
                type: "changeCredentials",
                original,
                factors: newFactors,
                credentials: next,
              }).then(() => {
                setOriginal(emptyCredentials());
                setNext(emptyCredentials());
                notify(
                  "Credentials changed. Old backups still need the old credentials.",
                );
              });
            }}
          >
            <h3>Verify original credentials</h3>
            <Credentials
              factors={factors}
              value={original}
              onChange={setOriginal}
            />
            <h3>Choose new credentials</h3>
            <Credentials
              factors={newFactors}
              value={next}
              onChange={setNext}
              setup
              onFactors={setNewFactors}
            />
            <button className="primary full" type="submit">
              <KeyRound size={16} />
              Re-encrypt with new credentials
            </button>
          </form>
          <div className="settings-section">
            <h3>
              <Fingerprint size={17} />
              Biometric quick unlock
            </h3>
            <p className="muted small">
              Optional, off by default. Available with Touch ID on macOS. Stores
              the vault key in the OS keychain; this creates an alternative to
              all credential groups. Verify your original credentials above
              before enabling.
            </p>
            <button
              className="secondary"
              onClick={() =>
                void request({
                  type: "enableQuickUnlock",
                  credentials: original,
                }).then(() => {
                  setOriginal(emptyCredentials());
                  notify("Touch ID quick unlock enabled.");
                })
              }
            >
              Enable Touch ID
            </button>
            <button
              className="text-button"
              onClick={() =>
                void request({ type: "disableQuickUnlock" }).then(() =>
                  notify("Quick unlock disabled."),
                )
              }
            >
              Disable
            </button>
          </div>
        </>
      )}
    </>
  );
}
