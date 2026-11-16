import { useState } from "react";
import { AlertTriangle, Check, FileText } from "lucide-react";
import type { ImportPreview, Category } from "../../shared/types";
import { CATEGORIES } from "../../shared/types";
export default function ImportView({
  preview: initial,
  request,
  notify,
  onDone,
}: {
  preview: ImportPreview;
  request: (c: unknown) => Promise<any>;
  notify: (s: string) => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState(initial);
  const [rows, setRows] = useState(initial.rows);
  const [mapping, setMapping] = useState(initial.mapping);
  const [summary, setSummary] = useState<{
    imported: number;
    skipped: number;
    duplicates: number;
    unmapped: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="notice">
        <AlertTriangle size={18} />
        <div>
          The source is plaintext. Keep it out of shared folders and remove it
          after importing. Passwords are parsed in the main process.
        </div>
      </div>
      <p className="row muted">
        <FileText size={16} />
        {preview.pathLabel} · {preview.format} · {rows.length} entries
      </p>
      {summary ? (
        <>
          <div className="import-summary">
            <Check size={32} />
            <h3>{summary.imported} imported</h3>
            <p>
              {summary.skipped} skipped · {summary.duplicates} duplicates
              reviewed
            </p>
            <p className="muted small">
              Unmapped fields: {summary.unmapped.join(", ") || "none"}. TOTP
              seeds and unsupported fields are not imported.
            </p>
          </div>
          <p className="muted small">
            Best-effort deletion overwrites the source before removing it. SSD
            wear leveling, snapshots, and backups can retain copies.
          </p>
          <div className="button-row">
            <button
              className="secondary danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Overwrite and delete the original plaintext source file? SSDs and backups may retain copies.",
                  )
                )
                  void request({
                    type: "deleteImportSource",
                    token: preview.token,
                    confirmation: "DELETE",
                  }).then(() => {
                    notify(
                      "Source file overwritten and removed; retained copies may still exist.",
                    );
                    onDone();
                  });
              }}
            >
              Delete plaintext source
            </button>
            <button className="primary" onClick={onDone}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <details open>
            <summary>Column mapping</summary>
            <div className="mapping-grid">
              {Object.keys(mapping).map((key) => (
                <label key={key}>
                  {key}
                  <select
                    value={mapping[key]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [key]: e.target.value })
                    }
                  >
                    <option value="">Auto-guess / not mapped</option>
                    {preview.headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="secondary small-button"
              onClick={() =>
                void request({
                  type: "importRemap",
                  token: preview.token,
                  mapping,
                }).then((p) => {
                  setPreview(p);
                  setRows(p.rows);
                  setMapping(p.mapping);
                })
              }
            >
              Apply mapping
            </button>
          </details>
          <div className="import-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Include</th>
                  <th>Name / username</th>
                  <th>Category</th>
                  <th>Duplicates</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        aria-label={`Include ${row.name}`}
                        type="checkbox"
                        checked={!row.skip}
                        onChange={(e) =>
                          setRows(
                            rows.map((r, i) =>
                              i === index
                                ? { ...r, skip: !e.target.checked }
                                : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{row.name}</strong>
                      <small>
                        {row.username || row.location || "No identifier"}
                      </small>
                    </td>
                    <td>
                      <select
                        aria-label={`Category for ${row.name}`}
                        value={row.category}
                        onChange={(e) =>
                          setRows(
                            rows.map((r, i) =>
                              i === index
                                ? {
                                    ...r,
                                    category: e.target.value as
                                      Category | "unsorted",
                                  }
                                : r,
                            ),
                          )
                        }
                      >
                        <option value="unsorted">Unsorted — review</option>
                        {Object.entries(CATEGORIES).map(([v, label]) => (
                          <option value={v} key={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {row.duplicateId ? (
                        <select
                          aria-label={`Duplicate action for ${row.name}`}
                          value={row.resolution}
                          onChange={(e) =>
                            setRows(
                              rows.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      resolution: e.target
                                        .value as typeof row.resolution,
                                    }
                                  : r,
                              ),
                            )
                          }
                        >
                          <option value="keep">Keep existing</option>
                          <option value="replace">Replace → old to Past</option>
                          <option value="both">Keep both</option>
                        </select>
                      ) : (
                        <span className="muted">New entry</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Included secrets become Current. Choose a category for every
            included row. Replacement keeps the old Current in Past.
          </p>
          <button
            className="primary full"
            disabled={
              busy || rows.some((r) => !r.skip && r.category === "unsorted")
            }
            onClick={() => {
              setBusy(true);
              void request({
                type: "importCommit",
                token: preview.token,
                rows: rows.map(({ id, skip, category, resolution }) => ({
                  id,
                  skip,
                  category,
                  resolution,
                })),
              })
                .then(setSummary)
                .finally(() => setBusy(false));
            }}
          >
            Confirm import of {rows.filter((r) => !r.skip).length} entries
          </button>
        </>
      )}
    </>
  );
}
