import { useState, useEffect } from "react";
import {
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
  Clock,
  KeyRound,
  Pencil,
  Trash2,
  ShieldCheck,
  ArrowUpRight,
  AlertTriangle,
  X,
} from "lucide-react";
import type { Entry, Vault, Rules } from "../../shared/types";
import { CATEGORIES, preset } from "../../shared/types";
import { validateSecret, manualWarnings } from "../../shared/rules";
import RulesPanel from "./RulesPanel";
export default function EntryDetail({
  entry: e,
  vault,
  request,
  edit,
  remove,
  notify,
  initialSection = "current",
}: {
  entry: Entry;
  vault: Vault;
  request: (c: unknown) => Promise<any>;
  edit: () => void;
  remove: () => void;
  notify: (s: string) => void;
  initialSection?: "current" | "past" | "new";
}) {
  const [section, setSection] = useState(initialSection);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [rules, setRules] = useState<Rules>(e.rules);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [presetName, setPresetName] = useState("");
  useEffect(() => {
    setRules(e.rules);
  }, [e.rules]);
  useEffect(() => {
    setRevealed(new Set());
    setValue("");
    setConfirm("");
    setAccepted(false);
  }, [section]);
  const toggle = (id: string) =>
    setRevealed((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const warnings = value
    ? [...validateSecret(value, rules), ...manualWarnings(value)]
    : [];
  const saveRules = async (next: Rules = rules) => {
    const {
      id,
      name,
      username,
      location,
      notes,
      tags,
      category,
      rotationDays,
    } = e;
    await request({
      type: "saveEntry",
      entry: {
        id,
        name,
        username,
        location,
        notes,
        tags,
        category,
        rotationDays,
        rules: next,
      },
    });
  };
  const generate = async () => {
    setBusy(true);
    try {
      const secret = await request({ type: "generate", rules });
      setValue(secret);
      setConfirm(secret);
      setAccepted(false);
    } finally {
      setBusy(false);
    }
  };
  const stage = async () => {
    setBusy(true);
    try {
      await saveRules();
      await request({
        type: "stage",
        id: e.id,
        value,
        confirm,
        acceptWarnings: accepted,
      });
      setValue("");
      setConfirm("");
      setSection("current");
      notify("Saved as Pending. Test it before making it Current.");
    } finally {
      setBusy(false);
    }
  };
  const secretRow = (
    secret: string,
    id: string,
    source: "current" | "past" | "pending",
    pastId?: string,
  ) => (
    <div className="secret-row">
      <code>{revealed.has(id) ? secret : "•••• •••• •••• ••••"}</code>
      <button
        className="icon-button"
        aria-label={revealed.has(id) ? "Hide secret" : "Reveal secret"}
        onClick={() => toggle(id)}
      >
        {revealed.has(id) ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
      <button
        className="icon-button"
        aria-label="Copy secret"
        onClick={() =>
          void request({ type: "copy", id: e.id, source, pastId }).then(() =>
            notify(
              `Copied. Clears in ${vault.preferences.clipboardSeconds} seconds.`,
            ),
          )
        }
      >
        <Copy size={17} />
      </button>
    </div>
  );
  return (
    <article className="entry-detail">
      <div className="detail-top">
        <div className={`entry-avatar large ${e.category}`}>
          {e.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <span className="eyebrow">{CATEGORIES[e.category]}</span>
          <h2>{e.name}</h2>
          <p className="muted">{e.username || "No username"}</p>
        </div>
        <button
          className="icon-button push-right"
          aria-label="Edit entry"
          onClick={edit}
        >
          <Pencil size={17} />
        </button>
        <button
          className="icon-button danger"
          aria-label="Delete entry"
          onClick={remove}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="entry-meta">
        <div>
          <span>
            {e.category === "hardware"
              ? "DEVICE / ADDRESS"
              : "WEBSITE / RESOURCE"}
          </span>
          <p className="break">
            {e.location || "Not added"}
            <ArrowUpRight size={13} />
          </p>
        </div>
        <div>
          <span>ROTATION REMINDER</span>
          <p>{e.rotationDays ? `Every ${e.rotationDays} days` : "Not set"}</p>
        </div>
      </div>
      {e.pending && (
        <div className="pending-callout">
          <div className="row">
            <Clock size={17} />
            <strong>New secret waiting for confirmation</strong>
          </div>
          <p>
            Your Current secret is safe. Try the new one on the service, then
            confirm the result here.
            {Date.now() - Date.parse(e.pending.createdAt) > 86400000
              ? " This has been pending for more than 24 hours."
              : ""}
          </p>
          {secretRow(e.pending.value, "pending", "pending")}
          <div className="button-row">
            <button
              className="primary small-button"
              onClick={() =>
                void request({ type: "resolve", id: e.id, worked: true }).then(
                  () =>
                    notify(
                      "New secret is Current. The previous secret is in Past.",
                    ),
                )
              }
            >
              <Check size={15} />
              It worked, make it Current
            </button>
            <button
              className="secondary small-button"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard the Pending secret? Current will stay unchanged.",
                  )
                )
                  void request({ type: "resolve", id: e.id, worked: false });
              }}
            >
              <X size={15} />
              Discard
            </button>
          </div>
        </div>
      )}
      <div className="accordion">
        {(["current", "past", "new"] as const).map((part, index) => (
          <section
            key={part}
            className={`accordion-item ${section === part ? "open" : ""}`}
          >
            <h3>
              <button
                aria-expanded={section === part}
                aria-controls={`panel-${part}`}
                id={`heading-${part}`}
                onClick={() => setSection(part)}
                onKeyDown={(event) => {
                  if (
                    ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                  ) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? 2
                          : (index + (event.key === "ArrowDown" ? 1 : 2)) % 3;
                    document
                      .getElementById(
                        `heading-${["current", "past", "new"][next]}`,
                      )
                      ?.focus();
                  }
                }}
              >
                <span className="accordion-icon">
                  {part === "current" ? (
                    <KeyRound size={17} />
                  ) : part === "past" ? (
                    <Clock size={17} />
                  ) : (
                    <RefreshCw size={17} />
                  )}
                </span>
                <span>
                  {part === "current"
                    ? "Current secret"
                    : part === "past"
                      ? "Past secrets"
                      : "New secret"}
                </span>
                <span className="badge">
                  {part === "current"
                    ? "Active"
                    : part === "past"
                      ? `${e.past.length} past`
                      : e.pending
                        ? "Pending"
                        : "Create"}
                </span>
                <ChevronDown size={17} />
              </button>
            </h3>
            {section === part && (
              <div
                className="accordion-content"
                id={`panel-${part}`}
                role="region"
                aria-labelledby={`heading-${part}`}
              >
                {part === "current" ? (
                  <>
                    {e.current ? (
                      secretRow(e.current, "current", "current")
                    ) : (
                      <div className="empty-inline">
                        No Current secret yet. Create one in New, then confirm
                        it works.
                      </div>
                    )}
                    <div className="row small muted">
                      <ShieldCheck size={14} />
                      {e.current
                        ? `Confirmed ${new Date(e.rotatedAt).toLocaleDateString()}`
                        : "Your first secret also uses the Pending safety step."}
                    </div>
                    {e.current && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setSection("new");
                          if (!vault.preferences.advanced) {
                            const {
                              theme,
                              reducedMotion,
                              autoLockMinutes,
                              clipboardSeconds,
                              rotationReminders,
                              breachEnabled,
                            } = vault.preferences;
                            void request({
                              type: "preferences",
                              preferences: {
                                advanced: true,
                                theme,
                                reducedMotion,
                                autoLockMinutes,
                                clipboardSeconds,
                                rotationReminders,
                                breachEnabled,
                              },
                            });
                          }
                          notify(
                            "Adjust the service restrictions below, then save the rules.",
                          );
                        }}
                      >
                        This was rejected → update password rules
                      </button>
                    )}
                    {vault.preferences.breachEnabled && e.current && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void request({ type: "breach", id: e.id }).then(
                            (r: any) =>
                              notify(
                                r.count
                                  ? `Found in ${r.count.toLocaleString()} breaches. Create a replacement.`
                                  : "Not found in this breach dataset. This is not a guarantee.",
                              ),
                          )
                        }
                      >
                        Check known breaches (sends a 5-character hash prefix)
                      </button>
                    )}
                  </>
                ) : part === "past" ? (
                  <>
                    {!e.past.length ? (
                      <p className="empty-inline">
                        Previous secrets appear here after a confirmed change.
                      </p>
                    ) : (
                      e.past.map((p) => (
                        <div className="past-item" key={p.id}>
                          <div className="row">
                            <span className="muted small">
                              Replaced {new Date(p.replacedAt).toLocaleString()}
                            </span>
                            <button
                              className="icon-button danger push-right"
                              aria-label="Permanently delete past secret"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Permanently delete this past secret? This cannot be undone in the current vault. Encrypted backups may retain it.",
                                  )
                                )
                                  void request({
                                    type: "deletePast",
                                    id: e.id,
                                    pastId: p.id,
                                    confirmation: "DELETE",
                                  });
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {secretRow(p.value, p.id, "past", p.id)}
                        </div>
                      ))
                    )}
                  </>
                ) : (
                  <>
                    {e.pending ? (
                      <p className="notice">
                        <AlertTriangle size={17} />
                        Resolve the existing Pending secret before creating
                        another.
                      </p>
                    ) : (
                      <>
                        <div className="segmented">
                          <button
                            className={mode === "generate" ? "active" : ""}
                            onClick={() => {
                              setMode("generate");
                              setValue("");
                              setConfirm("");
                            }}
                          >
                            Generate
                          </button>
                          <button
                            className={mode === "manual" ? "active" : ""}
                            onClick={() => {
                              setMode("manual");
                              setValue("");
                              setConfirm("");
                            }}
                          >
                            Enter manually
                          </button>
                        </div>
                        {mode === "generate" ? (
                          <>
                            <div className="generator-preview">
                              <code>
                                {value
                                  ? show
                                    ? value
                                    : "•••• •••• •••• ••••"
                                  : "Your next secret"}
                              </code>
                              <button
                                className="icon-button"
                                aria-label="Show generated secret"
                                onClick={() => setShow(!show)}
                              >
                                {show ? (
                                  <EyeOff size={17} />
                                ) : (
                                  <Eye size={17} />
                                )}
                              </button>
                              <button
                                className="icon-button"
                                disabled={busy}
                                aria-label="Generate secret"
                                onClick={() => void generate()}
                              >
                                <RefreshCw size={17} />
                              </button>
                            </div>
                            <button
                              className="secondary full"
                              disabled={busy}
                              onClick={() => void generate()}
                            >
                              <RefreshCw size={15} />
                              {value ? "Regenerate" : "Generate a secret"}
                            </button>
                          </>
                        ) : (
                          <>
                            <label>
                              New secret
                              <textarea
                                rows={3}
                                className={`manual-secret ${show ? "visible" : ""}`}
                                value={value}
                                onChange={(event) => {
                                  setValue(event.target.value);
                                  setAccepted(false);
                                }}
                                autoComplete="new-password"
                              />
                            </label>
                            <label>
                              Type it again
                              <textarea
                                rows={3}
                                className={`manual-secret ${show ? "visible" : ""}`}
                                value={confirm}
                                onChange={(event) =>
                                  setConfirm(event.target.value)
                                }
                                autoComplete="new-password"
                              />
                            </label>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={show}
                                onChange={(event) =>
                                  setShow(event.target.checked)
                                }
                              />
                              Show both fields
                            </label>
                            {confirm && value !== confirm && (
                              <p className="warning small">
                                The secrets do not match.
                              </p>
                            )}
                          </>
                        )}
                        {vault.preferences.advanced ? (
                          <>
                            <div className="two-col">
                              <label>
                                Preset
                                <select
                                  aria-label="Password preset"
                                  defaultValue="entry"
                                  onChange={(event) => {
                                    const p = vault.presets.find(
                                      (p) => p.name === event.target.value,
                                    );
                                    setRules(
                                      p?.rules ??
                                        preset(
                                          event.target
                                            .value as Entry["category"],
                                        ),
                                    );
                                    setValue("");
                                    setConfirm("");
                                  }}
                                >
                                  <option value="entry" disabled>
                                    Entry rules
                                  </option>
                                  <option value="hardware">
                                    Hardware · 20 characters
                                  </option>
                                  <option value="domains">
                                    Domains · 16 characters
                                  </option>
                                  <option value="api">
                                    API · 40 alphanumeric
                                  </option>
                                  {vault.presets.map((p) => (
                                    <option key={p.name}>{p.name}</option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Save a preset
                                <div className="input-action">
                                  <input
                                    value={presetName}
                                    onChange={(event) =>
                                      setPresetName(event.target.value)
                                    }
                                    placeholder="Preset name"
                                  />
                                  <button
                                    className="icon-button"
                                    disabled={!presetName}
                                    aria-label="Save password preset"
                                    onClick={() =>
                                      void request({
                                        type: "savePreset",
                                        name: presetName,
                                        rules,
                                      }).then(() => {
                                        setPresetName("");
                                        notify("Preset saved.");
                                      })
                                    }
                                  >
                                    <Check size={16} />
                                  </button>
                                </div>
                              </label>
                            </div>
                            <RulesPanel
                              value={rules}
                              onChange={(next) => {
                                setRules(next);
                                setValue("");
                                setConfirm("");
                              }}
                            />
                            <button
                              className="text-button"
                              onClick={() =>
                                void saveRules().then(() =>
                                  notify(
                                    "Password rules saved for this entry.",
                                  ),
                                )
                              }
                            >
                              Save password rules
                            </button>
                          </>
                        ) : (
                          <p className="muted small">
                            Uses this entry’s password rules. Switch to Advanced
                            to customize.
                          </p>
                        )}
                        {warnings.length > 0 && (
                          <div className="notice block">
                            <strong>Check before saving</strong>
                            {warnings.map((w) => (
                              <p key={w}>{w}</p>
                            ))}
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={accepted}
                                onChange={(event) =>
                                  setAccepted(event.target.checked)
                                }
                              />
                              I understand; preserve exactly what I entered.
                            </label>
                          </div>
                        )}
                        <button
                          className="primary full"
                          disabled={
                            busy ||
                            !value ||
                            value !== confirm ||
                            (warnings.length > 0 && !accepted)
                          }
                          onClick={() => void stage()}
                        >
                          <Check size={16} />
                          Save as Pending
                        </button>
                        <p className="muted small centered">
                          Current stays safe until you confirm the new secret
                          works.
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      {(e.notes || e.tags.length > 0) && (
        <div className="detail-notes">
          {e.tags.length > 0 && (
            <div className="tags">
              {e.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
          {e.notes && (
            <>
              <span className="eyebrow">Notes</span>
              <p className="preserve">{e.notes}</p>
            </>
          )}
        </div>
      )}
      <div className="detail-footer">
        Added {new Date(e.createdAt).toLocaleDateString()}
        <span>Updated {new Date(e.updatedAt).toLocaleDateString()}</span>
      </div>
    </article>
  );
}
