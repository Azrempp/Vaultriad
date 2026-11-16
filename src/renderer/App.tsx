import { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield,
  ShieldCheck,
  LockKeyhole,
  Search,
  Plus,
  Globe,
  Server,
  Terminal,
  ChevronRight,
  Settings as SettingsIcon,
  LogOut,
  ArrowRight,
  ArrowLeft,
  Check,
  FolderOpen,
  Download,
  PanelLeft,
  LayoutGrid,
  Activity,
  KeyRound,
  Clock,
  AlertTriangle,
  LoaderCircle,
  Fingerprint,
  X,
  CheckCheck,
  HardDrive,
  Info,
} from "lucide-react";
import type {
  Vault,
  Entry,
  Category,
  PublicStatus,
  Factors,
  ImportPreview,
  Preferences,
} from "../shared/types";
import { CATEGORIES, DEFAULT_PREFERENCES, preset } from "../shared/types";
import Modal from "./components/Modal";
import {
  Credentials,
  emptyCredentials,
  defaultFactors,
} from "./components/Credentials";
import EntryDetail from "./components/EntryDetail";
import Settings, { preferenceFields, prefsInput } from "./components/Settings";
import ImportView from "./components/ImportView";
const categoryIcons = { hardware: Server, domains: Globe, api: Terminal };
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <div className="brand-mark">
        <Shield size={29} strokeWidth={1.6} />
        <span />
        <i />
      </div>
      <div>
        Vaultriad{!compact && <small>YOUR SECRETS. YOUR CONTROL.</small>}
      </div>
    </div>
  );
}
function health(entries: Entry[]) {
  const counts = new Map<string, number>();
  entries.forEach((e) => {
    if (e.current) counts.set(e.current, (counts.get(e.current) || 0) + 1);
  });
  return entries.flatMap((e) => {
    const problems: string[] = [];
    if (
      !e.current ||
      e.current.length < 12 ||
      /^(.)\1+$/.test(e.current) ||
      /^\d+$/.test(e.current)
    )
      problems.push("Weak or missing secret");
    if (e.current && (counts.get(e.current) || 0) > 1)
      problems.push("Reused secret");
    if (
      e.rotationDays &&
      Date.now() - Date.parse(e.rotatedAt) > e.rotationDays * 86400000
    )
      problems.push("Rotation overdue");
    if (e.pending)
      problems.push(
        Date.now() - Date.parse(e.pending.createdAt) > 86400000
          ? "Pending for over 24 hours"
          : "Unresolved Pending",
      );
    if (!e.rotationDays) problems.push("No rotation reminder");
    return problems.length ? [{ entry: e, problems }] : [];
  });
}
export default function App() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState("");
  const epoch = useRef(0);
  const [credentials, setCredentials] = useState(emptyCredentials());
  const [factors, setFactors] = useState(defaultFactors());
  const [step, setStep] = useState(0);
  const [preferences, setPreferences] = useState({ ...DEFAULT_PREFERENCES });
  const [backupPath, setBackupPath] = useState("Documents / Vaultriad Backups");
  const [restore, setRestore] = useState<{
    factors: Factors;
    name: string;
  } | null>(null);
  const [reset, setReset] = useState(false);
  const [resetText, setResetText] = useState("");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [page, setPage] = useState<"vault" | "health">("vault");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [section, setSection] = useState<"current" | "new">("current");
  const [sort, setSort] = useState("name");
  const [modal, setModal] = useState<"entry" | "settings" | null>(null);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [now, setNow] = useState(Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  const notify = useCallback((s: string) => setToast(s), []);
  const request = useCallback(async (c: unknown): Promise<any> => {
    if (!window.vault)
      throw Error("Open Vaultriad in the Electron desktop app.");
    const before = epoch.current;
    const r = await window.vault.request<any>(c);
    if (
      before !== epoch.current &&
      (c as { type?: string }).type !== "reset" &&
      (c as { type?: string }).type !== "lock"
    )
      throw Error("Vault locked during the operation.");
    if (!r.ok) {
      setError(r.error || "Operation failed.");
      setToast(r.error || "Operation failed.");
      throw Error(r.error);
    }
    setError("");
    if (r.data?.version === 1 && Array.isArray(r.data.entries))
      setVault(r.data);
    return r.data;
  }, []);
  const refreshStatus = useCallback(async () => {
    if (!window.vault) {
      setFatal(
        "Vaultriad requires its Electron desktop shell. Run npm run dev to open the secure app.",
      );
      return;
    }
    const result = await window.vault.request<PublicStatus>({ type: "status" });
    if (result.ok && result.data) setStatus(result.data);
  }, []);
  const clear = useCallback(() => {
    epoch.current++;
    setVault(null);
    setCredentials(emptyCredentials());
    setRestore(null);
    setModal(null);
    setImportPreview(null);
    setDraft(null);
    setSelected(null);
    setSearch("");
    setReset(false);
    setResetText("");
    setToast("");
    setError("");
    setBusy(false);
    void refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    void refreshStatus();
    const off = window.vault?.onLock(clear);
    const reject = (e: PromiseRejectionEvent) => {
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", reject);
    return () => {
      off?.();
      window.removeEventListener("unhandledrejection", reject);
    };
  }, [refreshStatus, clear]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!vault) return;
    let last = 0;
    const activity = (e: Event) => {
      if (!e.isTrusted) return;
      if (Date.now() - last > 1000) {
        last = Date.now();
        void window.vault.request({ type: "activity" });
      }
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [!!vault]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const p = vault?.preferences ?? preferences;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme =
        p.theme === "system" ? (media.matches ? "light" : "dark") : p.theme;
      document.documentElement.dataset.motion = p.reducedMotion
        ? "reduced"
        : "full";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [vault?.preferences, preferences]);
  const openNew = useCallback(() => {
    setDraft(null);
    setModal("entry");
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (vault && e.key === ",") {
          e.preventDefault();
          setModal("settings");
        }
        if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          void request({ type: "lock" });
        }
        if (vault && e.key.toLowerCase() === "f") {
          e.preventDefault();
          searchRef.current?.focus();
        }
        if (vault && e.key.toLowerCase() === "n") {
          e.preventDefault();
          openNew();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [vault, openNew, request]);
  const attempt = async () => {
    setBusy(true);
    try {
      if (restore) {
        await request({ type: "restore", credentials });
        setRestore(null);
      } else if (status?.exists) await request({ type: "unlock", credentials });
      else
        await request({
          type: "setup",
          factors,
          credentials,
          preferences: prefsInput(preferences),
        });
      setCredentials(emptyCredentials());
      await refreshStatus();
    } catch {
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };
  const startRestore = async () => {
    const result = await request({ type: "inspectBackup" });
    if (result) {
      setRestore(result);
      setCredentials(emptyCredentials());
      setError("");
    }
  };
  const switchAdvanced = async () => {
    if (vault)
      await request({
        type: "preferences",
        preferences: {
          ...prefsInput(vault.preferences),
          advanced: !vault.preferences.advanced,
        },
      });
  };
  if (fatal)
    return (
      <div className="boot-screen">
        <Brand />
        <p>{fatal}</p>
      </div>
    );
  if (!status)
    return (
      <div className="boot-screen">
        <Brand />
        <LoaderCircle className="spin" />
      </div>
    );
  if (!vault) {
    const isSetup = !status.exists && !restore;
    const shownFactors = restore?.factors ?? status.factors ?? factors;
    return (
      <div className="auth-layout">
        <aside className="auth-story">
          <Brand />
          <div className="auth-story-content">
            <span className="eyebrow">A QUIETER KIND OF SECURITY</span>
            <h1>
              Your digital life.
              <br />
              <em>Safely in your hands.</em>
            </h1>
            <p>
              One private home for your devices, accounts, and keys. Built to
              stay with you.
            </p>
            <div className="vault-art">
              <div className="vault-ring outer" />
              <div className="vault-ring inner" />
              <div className="vault-center">
                <ShieldCheck size={70} strokeWidth={1} />
              </div>
              <span className="orbit-dot one" />
              <span className="orbit-dot two" />
              <span className="orbit-dot three" />
            </div>
            <div className="story-features">
              <span>
                <HardDrive size={16} />
                Local by design
              </span>
              <span>
                <ShieldCheck size={16} />
                Encrypted at rest
              </span>
              <span>
                <Globe size={16} />
                No cloud required
              </span>
            </div>
          </div>
          <p className="auth-footer">
            <span className="status-dot" />
            Your vault never leaves this computer unless you export it.
          </p>
        </aside>
        <main className="auth-main">
          <div className="auth-form">
            <span className="auth-icon">
              <LockKeyhole size={25} />
            </span>
            <div className="eyebrow">
              {restore
                ? "ENCRYPTED BACKUP"
                : isSetup
                  ? "WELCOME TO VAULTRIAD"
                  : "YOUR PRIVATE SPACE"}
            </div>
            <h2>
              {restore
                ? "Restore your vault"
                : isSetup
                  ? ["Make it yours.", "A little peace of mind.", "Settle in."][
                      step
                    ]
                  : "Welcome back."}
            </h2>
            <p className="muted">
              {restore
                ? `Enter the original credentials for ${restore.name}.`
                : isSetup
                  ? [
                      "Set up the credentials that keep your vault safe.",
                      "Choose where your encrypted backups will live.",
                      "A few preferences, then you’re ready.",
                    ][step]
                  : "Unlock your vault. Everything is right where you left it."}
            </p>
            {isSetup && (
              <div className="wizard-steps">
                {["Credentials", "Backups", "Preferences"].map((label, i) => (
                  <span key={label} className={i <= step ? "active" : ""}>
                    <i>{i < step ? <Check size={12} /> : i + 1}</i>
                    {label}
                  </span>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (isSetup && step < 2) setStep(step + 1);
                else void attempt();
              }}
            >
              {isSetup ? (
                step === 0 ? (
                  <Credentials
                    setup
                    factors={factors}
                    value={credentials}
                    onChange={setCredentials}
                    onFactors={setFactors}
                  />
                ) : step === 1 ? (
                  <div className="wizard-backup">
                    <FolderOpen size={35} />
                    <h3>A safe place for a second copy</h3>
                    <p className="muted">
                      Backups stay encrypted with the credentials used when they
                      were created. Keep a copy on another drive.
                    </p>
                    <div className="folder-path">{backupPath}</div>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() =>
                        void request({ type: "chooseBackupDirectory" }).then(
                          setBackupPath,
                        )
                      }
                    >
                      Choose folder
                    </button>
                    <p className="notice">
                      There’s no password reset that recovers your secrets. Keep
                      your credentials and an off-computer backup safe.
                    </p>
                  </div>
                ) : (
                  preferenceFields(preferences, setPreferences)
                )
              ) : (
                <Credentials
                  factors={shownFactors}
                  value={credentials}
                  onChange={setCredentials}
                />
              )}
              {error && (
                <p role="alert" className="form-error">
                  <AlertTriangle size={16} />
                  {error}
                </p>
              )}
              <div className="button-row">
                {isSetup && step > 0 && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setStep(step - 1)}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                )}
                <button
                  className="primary full"
                  type="submit"
                  disabled={
                    busy ||
                    now < status.retryAt ||
                    (isSetup &&
                      !factors.password &&
                      !factors.pin &&
                      !factors.questions.length)
                  }
                >
                  {busy ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : isSetup && step < 2 ? (
                    "Continue"
                  ) : restore ? (
                    "Restore vault"
                  ) : isSetup ? (
                    "Create my vault"
                  ) : (
                    "Unlock vault"
                  )}
                  {!busy && <ArrowRight size={17} />}
                </button>
              </div>
            </form>
            {now < status.retryAt && (
              <p className="centered muted small">
                Try again in {Math.ceil((status.retryAt - now) / 1000)} seconds.
              </p>
            )}
            {restore ? (
              <button
                className="text-button centered full"
                onClick={() => {
                  setRestore(null);
                  setCredentials(emptyCredentials());
                }}
              >
                Cancel restore
              </button>
            ) : isSetup ? (
              <button
                className="text-button centered full"
                onClick={() => void startRestore()}
              >
                <Download size={15} />
                Already have a vault? Restore a backup
              </button>
            ) : (
              <>
                {status.quickUnlock && (
                  <button
                    className="text-button centered full"
                    onClick={() =>
                      void request({ type: "quickUnlock" }).then(() =>
                        refreshStatus(),
                      )
                    }
                  >
                    <Fingerprint size={17} />
                    Use Touch ID
                  </button>
                )}
                {error && (
                  <p className="reset-explainer">
                    Can’t get in? You can reset and start from scratch. Your
                    current vault will be saved as an encrypted backup you can
                    restore later with your original credentials.
                  </p>
                )}
                <button
                  className="text-button centered full"
                  onClick={() => setReset(true)}
                >
                  Reset and start over
                </button>
              </>
            )}
            <div className="auth-assurance">
              <ShieldCheck size={14} />
              <span>AES-256 encryption · Stored only on your device</span>
            </div>
          </div>
        </main>
        {reset && (
          <Modal title="Reset and start over" onClose={() => setReset(false)}>
            <p>
              Your existing vault will be saved as an encrypted .vtbackup before
              it is removed. It will still require the original credentials
              {status.factors?.bound ? " and this computer’s OS keychain" : ""}.
            </p>
            <p className="muted small">
              Default: Documents/Vaultriad Backups. Keep a copy somewhere safe.
            </p>
            <button
              className="secondary"
              onClick={() =>
                void request({ type: "chooseBackupDirectory" }).then((path) =>
                  notify(`Backup folder: ${path}`),
                )
              }
            >
              Change backup folder
            </button>
            <label>
              Type RESET to continue
              <input
                autoFocus
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
              />
            </label>
            <button
              className="danger-button full"
              disabled={resetText !== "RESET" || busy}
              onClick={() => {
                setBusy(true);
                void request({ type: "reset", confirmation: "RESET" })
                  .then((r) => {
                    setReset(false);
                    setResetText("");
                    setStep(0);
                    setCredentials(emptyCredentials());
                    notify(`Encrypted backup saved: ${r.path}`);
                    return refreshStatus();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Back up and reset vault
            </button>
          </Modal>
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    );
  }
  const selectedEntry = vault.entries.find((e) => e.id === selected);
  const issues = health(vault.entries);
  const pending = vault.entries.filter((e) => e.pending).length;
  const filtered = vault.entries
    .filter(
      (e) =>
        (filter === "all" || e.category === filter) &&
        `${e.name} ${e.username} ${e.location} ${e.tags.join(" ")} ${e.notes}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "updated"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : a.name.localeCompare(b.name),
    );
  const fullyProtected =
    status.factors?.password &&
    status.factors.pin &&
    status.factors.questions.length === 3;
  const needsBackup =
    !vault.preferences.lastBackupAt ||
    now - Date.parse(vault.preferences.lastBackupAt) > 30 * 86400000;
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand compact />
        <button
          className="vault-switch"
          onClick={() => {
            setPage("vault");
            setFilter("all");
          }}
        >
          <span className="vault-switch-icon">
            <LockKeyhole size={18} />
          </span>
          <span>
            Personal vault<small>Stored on this device</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          <button
            className={page === "vault" && filter === "all" ? "active" : ""}
            onClick={() => {
              setPage("vault");
              setFilter("all");
            }}
          >
            <LayoutGrid size={18} />
            All entries<span className="nav-count">{vault.entries.length}</span>
          </button>
          {Object.entries(CATEGORIES).map(([key, label]) => {
            const Icon = categoryIcons[key as Category];
            return (
              <button
                key={key}
                className={page === "vault" && filter === key ? "active" : ""}
                onClick={() => {
                  setPage("vault");
                  setFilter(key as Category);
                  setSelected(null);
                }}
              >
                <Icon size={18} />
                {label}
                <span className="nav-count">
                  {vault.entries.filter((e) => e.category === key).length}
                </span>
              </button>
            );
          })}
          {vault.preferences.advanced && (
            <>
              <span className="nav-label">INSIGHTS</span>
              <button
                className={page === "health" ? "active" : ""}
                onClick={() => setPage("health")}
              >
                <Activity size={18} />
                Security health
                {issues.length > 0 && (
                  <span className="nav-count attention">{issues.length}</span>
                )}
              </button>
              <button
                onClick={() =>
                  void request({ type: "importPreview" }).then((p) => {
                    if (p) setImportPreview(p);
                  })
                }
              >
                <Download size={18} />
                Import passwords
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={21} />
            </span>
            <strong>Private by default</strong>
            <p>
              Your secrets stay on your device, encrypted and under your
              control.
            </p>
            <span>
              <i className="status-dot" />
              No cloud sync
            </span>
          </div>
          <button
            className="sidebar-action"
            onClick={() => setModal("settings")}
          >
            <SettingsIcon size={17} />
            Settings<span className="keycap">⌘ ,</span>
          </button>
          <button
            className="sidebar-action"
            onClick={() => void request({ type: "lock" })}
          >
            <LogOut size={17} />
            Lock vault<span className="keycap">⌘ L</span>
          </button>
          <div className="sidebar-version">
            <span>VAULTRIAD</span>
            <button onClick={() => void request({ type: "about" })}>
              v1.0.0 <Info size={12} />
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Personal vault
            <ChevronRight size={14} />
            <span>
              {page === "health"
                ? "Security health"
                : filter === "all"
                  ? "All entries"
                  : CATEGORIES[filter]}
            </span>
          </div>
          <div className="topbar-right">
            <span className="unlocked">
              <i className="status-dot" />
              Vault unlocked
            </span>
            <span className="vertical-line" />
            <button
              className={`view-toggle ${vault.preferences.advanced ? "on" : ""}`}
              onClick={() => void switchAdvanced()}
            >
              <span className="toggle-track">
                <i />
              </span>
              Advanced
            </button>
            <button
              className="icon-button"
              aria-label="Lock vault"
              onClick={() => void request({ type: "lock" })}
            >
              <LockKeyhole size={17} />
            </button>
          </div>
        </header>
        <div className="workspace-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR SECURE WORKSPACE</div>
              <h1>
                {page === "health"
                  ? "A healthier digital life."
                  : filter === "all"
                    ? "All entries"
                    : CATEGORIES[filter]}
              </h1>
              <p className="muted">
                {page === "health"
                  ? "A little maintenance. A lot more peace of mind."
                  : filter === "all"
                    ? "Everything important. In one safe place."
                    : filter === "hardware"
                      ? "Keep every device’s access details close."
                      : filter === "domains"
                        ? "A private home for your online accounts."
                        : "Your tools and tokens, safely organized."}
              </p>
            </div>
            <button className="primary add-button" onClick={openNew}>
              <Plus size={18} />
              Add entry<span className="button-key">⌘ N</span>
            </button>
          </div>
          {page === "vault" ? (
            <>
              {vault.preferences.advanced && (
                <div className="overview-grid">
                  <button
                    className="overview-card"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                  >
                    <span className="stat-icon">
                      <KeyRound size={19} />
                    </span>
                    <div>
                      <span>Total entries</span>
                      <strong>
                        {vault.entries.length.toString().padStart(2, "0")}
                      </strong>
                    </div>
                    <span className="stat-foot">In your personal vault</span>
                  </button>
                  <button
                    className="overview-card"
                    onClick={() => {
                      if (vault.preferences.advanced) setPage("health");
                      else {
                        void switchAdvanced();
                        setPage("health");
                      }
                    }}
                  >
                    <span className="stat-icon amber">
                      <Clock size={19} />
                    </span>
                    <div>
                      <span>Awaiting confirmation</span>
                      <strong>{pending.toString().padStart(2, "0")}</strong>
                    </div>
                    <span className="stat-foot">
                      {pending ? "New secrets to test" : "No pending changes"}
                    </span>
                  </button>
                  <button
                    className="overview-card security"
                    onClick={() => {
                      void (vault.preferences.advanced
                        ? Promise.resolve()
                        : switchAdvanced());
                      setPage("health");
                    }}
                  >
                    <span className="stat-icon green">
                      <ShieldCheck size={20} />
                    </span>
                    <div>
                      <span>Vault protection</span>
                      <strong className="word-stat">
                        {fullyProtected
                          ? "All factors enabled"
                          : "Review setup"}
                      </strong>
                    </div>
                    <span className="stat-foot">
                      AES-256-GCM encryption
                      <ChevronRight size={14} />
                    </span>
                  </button>
                </div>
              )}
              <div className="vault-panel">
                <div className="list-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      ref={searchRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search your vault..."
                      aria-label="Search vault"
                    />
                    <kbd>⌘ F</kbd>
                  </div>
                  <select
                    className="sort-select"
                    aria-label="Sort entries"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="name">Name: A to Z</option>
                    <option value="updated">Recently updated</option>
                  </select>
                </div>
                <div
                  className={`vault-split ${selectedEntry ? "has-selection" : ""}`}
                >
                  <section className="entry-list" aria-label="Vault entries">
                    <div className="list-heading">
                      <span>
                        {filter === "all"
                          ? "ALL ENTRIES"
                          : CATEGORIES[filter].toUpperCase()}
                      </span>
                      <span>
                        {filtered.length}{" "}
                        {filtered.length === 1 ? "entry" : "entries"}
                      </span>
                    </div>
                    {filtered.length ? (
                      filtered.map((e) => {
                        const Icon = categoryIcons[e.category];
                        return (
                          <button
                            className={`entry-list-item ${e.id === selected ? "selected" : ""}`}
                            key={e.id}
                            onClick={() => {
                              setSelected(e.id);
                              setSection("current");
                            }}
                          >
                            <div className={`entry-avatar ${e.category}`}>
                              <Icon size={20} />
                            </div>
                            <div className="entry-list-text">
                              <strong>{e.name}</strong>
                              <span>
                                {e.username ||
                                  e.location ||
                                  CATEGORIES[e.category]}
                              </span>
                            </div>
                            {e.pending ? (
                              <span
                                className="pending-dot"
                                title="Pending confirmation"
                              />
                            ) : vault.preferences.rotationReminders &&
                              e.rotationDays &&
                              now - Date.parse(e.rotatedAt) >
                                e.rotationDays * 86400000 ? (
                              <Clock
                                size={15}
                                className="warning"
                                aria-label="Rotation reminder due"
                              />
                            ) : (
                              <ShieldCheck size={15} className="list-shield" />
                            )}
                            <ChevronRight size={15} />
                          </button>
                        );
                      })
                    ) : (
                      <div className="empty-list">
                        <Search size={24} />
                        <strong>
                          {search ? "No matching entries" : "A fresh start"}
                        </strong>
                        <p>
                          {search
                            ? "Try a different name, tag, or username."
                            : "Your entries will appear here."}
                        </p>
                        {!search && (
                          <button className="text-button" onClick={openNew}>
                            Add your first entry <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                  <section className="detail-pane" aria-label="Entry details">
                    {selectedEntry ? (
                      <EntryDetail
                        key={`${selectedEntry.id}-${section}`}
                        initialSection={section}
                        entry={selectedEntry}
                        vault={vault}
                        request={request}
                        edit={() => {
                          setDraft(selectedEntry);
                          setModal("entry");
                        }}
                        remove={() => {
                          if (
                            window.confirm(
                              `Permanently delete “${selectedEntry.name}” and its history? Encrypted backups may retain copies.`,
                            )
                          )
                            void request({
                              type: "deleteEntry",
                              id: selectedEntry.id,
                              confirmation: "DELETE",
                            }).then(() => {
                              setSelected(null);
                              notify("Entry deleted.");
                            });
                        }}
                        notify={notify}
                      />
                    ) : (
                      <div className="welcome-empty">
                        <div className="empty-orbit">
                          <div />
                          <ShieldCheck size={42} strokeWidth={1.2} />
                        </div>
                        <span className="eyebrow">
                          A SAFE PLACE FOR WHAT MATTERS
                        </span>
                        <h2>
                          {vault.entries.length
                            ? "Your secrets, within reach."
                            : "Less worry. More peace of mind."}
                        </h2>
                        <p>
                          {vault.entries.length
                            ? "Select an entry to view its details, manage a password, or check its history."
                            : "Give your passwords, devices, and API keys a secure home. Add your first entry to get started."}
                        </p>
                        <button className="primary" onClick={openNew}>
                          <Plus size={17} />
                          {vault.entries.length
                            ? "Add an entry"
                            : "Add your first entry"}
                        </button>
                        <div className="empty-categories">
                          <span>
                            <Server size={16} />
                            Hardware
                          </span>
                          <span>
                            <Globe size={16} />
                            Domains
                          </span>
                          <span>
                            <Terminal size={16} />
                            API keys
                          </span>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </>
          ) : (
            <div className="health-page">
              <div
                className={`health-banner ${issues.length ? "needs-care" : ""}`}
              >
                <ShieldCheck size={32} />
                <div>
                  <h2>
                    {issues.length
                      ? `${issues.length} entries could use some care`
                      : "Your vault is looking healthy"}
                  </h2>
                  <p className="muted">
                    All checks happen locally. No passwords are sent anywhere.
                  </p>
                </div>
              </div>
              {!fullyProtected && (
                <div className="health-issue">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>Less protected credential setup</strong>
                    <p>
                      Not all three credential groups are enabled. Review your
                      unlock credentials.
                    </p>
                  </div>
                  <button
                    className="secondary small-button"
                    onClick={() => setModal("settings")}
                  >
                    Review settings
                  </button>
                </div>
              )}
              {issues.map(({ entry, problems }) => (
                <div className="health-issue" key={entry.id}>
                  <div className={`entry-avatar ${entry.category}`}>
                    {entry.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <strong>{entry.name}</strong>
                    <p>{problems.join(" · ")}</p>
                  </div>
                  <button
                    className="secondary small-button"
                    onClick={() => {
                      setSelected(entry.id);
                      setSection(entry.pending ? "current" : "new");
                      setFilter("all");
                      setSearch("");
                      setPage("vault");
                    }}
                  >
                    Fix this
                    <ArrowRight size={14} />
                  </button>
                </div>
              ))}
              {!issues.length && (
                <p className="muted centered">
                  Keep unique, long secrets and confirm every pending change.
                </p>
              )}
            </div>
          )}
          {needsBackup && (
            <div className="backup-reminder">
              <div>
                <HardDrive size={17} />
                <span>
                  <strong>A second copy is peace of mind.</strong> Keep an
                  encrypted backup off this computer.
                </span>
              </div>
              <button
                onClick={() =>
                  void request({ type: "backup" }).then((r) =>
                    notify(`Encrypted backup saved: ${r.path}`),
                  )
                }
              >
                Back up vault
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={13} />
              End-to-device privacy. Always.
            </span>
            <span>
              Auto-lock after {vault.preferences.autoLockMinutes} min ·
              Clipboard clears in {vault.preferences.clipboardSeconds}s
            </span>
          </footer>
        </div>
      </main>
      {modal === "entry" && (
        <Modal
          title={draft ? "Edit entry" : "Add a new entry"}
          onClose={() => {
            setModal(null);
            setDraft(null);
          }}
        >
          <EntryForm
            entry={draft}
            category={filter === "all" ? "domains" : filter}
            onSave={async (entry) => {
              const data = await request({ type: "saveEntry", entry });
              setModal(null);
              setDraft(null);
              const saved = draft
                ? data.entries.find((e: Entry) => e.id === draft.id)
                : data.entries[data.entries.length - 1];
              setSelected(saved.id);
              setSection(draft ? "current" : "new");
              setFilter("all");
              setPage("vault");
              setSearch("");
              notify(
                draft
                  ? "Entry updated."
                  : "Entry created. Add its first secret in New.",
              );
            }}
          />
        </Modal>
      )}
      {modal === "settings" && (
        <Modal
          title="Your vault, your preferences"
          onClose={() => setModal(null)}
        >
          <Settings
            vault={vault}
            factors={status.factors!}
            request={async (c) => {
              const r = await request(c);
              await refreshStatus();
              return r;
            }}
            notify={notify}
          />
        </Modal>
      )}
      {importPreview && (
        <Modal
          title="Review password import"
          wide
          onClose={() => {
            setImportPreview(null);
          }}
        >
          <ImportView
            preview={importPreview}
            request={request}
            notify={notify}
            onDone={() => {
              setImportPreview(null);
              void request({ type: "snapshot" });
            }}
          />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function EntryForm({
  entry,
  category,
  onSave,
}: {
  entry: Entry | null;
  category: Category;
  onSave: (v: unknown) => Promise<void>;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [cat, setCat] = useState(entry?.category ?? category);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
  const [rotation, setRotation] = useState(entry?.rotationDays ?? 90);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSave({
          ...(entry ? { id: entry.id } : {}),
          name,
          username,
          location,
          notes,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          category: cat,
          rotationDays: rotation || null,
          rules: entry?.rules ?? preset(cat),
        }).finally(() => setBusy(false));
      }}
    >
      <div className="category-choices">
        {Object.entries(CATEGORIES).map(([key, label]) => {
          const Icon = categoryIcons[key as Category];
          return (
            <button
              key={key}
              type="button"
              className={cat === key ? "active" : ""}
              onClick={() => setCat(key as Category)}
            >
              <Icon size={20} />
              {label}
            </button>
          );
        })}
      </div>
      <label>
        Name
        <input
          autoFocus
          required
          maxLength={200}
          placeholder={
            cat === "hardware"
              ? "e.g. Home router"
              : cat === "api"
                ? "e.g. Production API key"
                : "e.g. GitHub"
          }
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Username / identifier
        <input
          maxLength={1000}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Email, username, or key identifier"
        />
      </label>
      <label>
        {cat === "hardware" ? "Device address / details" : "URL / resource"}
        <input
          maxLength={2000}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={
            cat === "hardware"
              ? "192.168.1.1 · Home office"
              : "https://example.com"
          }
        />
      </label>
      <div className="two-col">
        <label>
          Tags
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="work, personal"
          />
        </label>
        <label>
          Rotation reminder
          <select
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
          >
            <option value="0">No reminder</option>
            {[30, 60, 90, 180, 365].map((n) => (
              <option value={n} key={n}>
                Every {n} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Notes
        <textarea
          rows={3}
          maxLength={20000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything useful to remember"
        />
      </label>
      {!entry && (
        <p className="notice">
          <ShieldCheck size={16} />
          You’ll add the secret next. New secrets stay Pending until you confirm
          they work.
        </p>
      )}
      <button
        className="primary full"
        type="submit"
        disabled={busy || !name.trim()}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Check size={16} />
        )}{" "}
        {entry ? "Save changes" : "Create entry"}
      </button>
    </form>
  );
}
