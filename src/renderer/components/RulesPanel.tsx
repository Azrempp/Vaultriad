import type { Rules } from "../../shared/types";
export default function RulesPanel({
  value: r,
  onChange,
}: {
  value: Rules;
  onChange: (v: Rules) => void;
}) {
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) =>
    onChange({ ...r, [k]: v });
  return (
    <div className="rules-panel">
      <div className="segmented">
        <button
          type="button"
          className={r.mode === "password" ? "active" : ""}
          onClick={() => set("mode", "password")}
        >
          Password
        </button>
        <button
          type="button"
          className={r.mode === "passphrase" ? "active" : ""}
          onClick={() =>
            onChange({
              ...r,
              mode: "passphrase",
              minUpper: 0,
              minNumbers: 0,
              minSymbols: 0,
              max: 128,
            })
          }
        >
          Passphrase
        </button>
      </div>
      {r.mode === "password" ? (
        <>
          <label>
            Length <span className="inline-value">{r.length} characters</span>
            <div className="range-row">
              <input
                aria-label="Generated password length"
                type="range"
                min="8"
                max="128"
                value={r.length}
                onChange={(e) => set("length", Number(e.target.value))}
              />
              <input
                aria-label="Length"
                type="number"
                min="8"
                max="128"
                value={r.length}
                onChange={(e) => set("length", Number(e.target.value))}
              />
            </div>
          </label>
          <div className="check-grid">
            {(["upper", "lower", "numbers", "symbols"] as const).map(
              (key, i) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={r[key]}
                    onChange={(e) => set(key, e.target.checked)}
                  />
                  {
                    [
                      "Uppercase A–Z",
                      "Lowercase a–z",
                      "Numbers 0–9",
                      "Symbols !@#",
                    ][i]
                  }
                </label>
              ),
            )}
          </div>
          <label>
            Allowed symbols
            <input
              value={r.allowedSymbols}
              onChange={(e) => set("allowedSymbols", e.target.value)}
            />
          </label>
        </>
      ) : (
        <div className="two-col">
          <label>
            Word count
            <input
              type="number"
              min="3"
              max="16"
              value={r.words}
              onChange={(e) => set("words", Number(e.target.value))}
            />
          </label>
          <label>
            Separator
            <input
              value={r.separator}
              onChange={(e) => set("separator", e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={r.capitalize}
              onChange={(e) => set("capitalize", e.target.checked)}
            />
            Capitalize words
          </label>
          <p className="muted small">
            ~{Math.floor(r.words * 7.9)} bits of word entropy. Use 8+ words for
            high-value accounts.
          </p>
        </div>
      )}
      <details>
        <summary>Service restrictions & character rules</summary>
        <div className="two-col">
          <label>
            Minimum length
            <input
              type="number"
              min="1"
              max="128"
              value={r.min}
              onChange={(e) => set("min", Number(e.target.value))}
            />
          </label>
          <label>
            Maximum length
            <input
              type="number"
              min="1"
              max="128"
              value={r.max}
              onChange={(e) => set("max", Number(e.target.value))}
            />
          </label>
          <label>
            Allowed characters only
            <input
              placeholder="All selected types"
              value={r.allowed}
              onChange={(e) => set("allowed", e.target.value)}
            />
          </label>
          <label>
            Excluded characters
            <input
              value={r.excluded}
              onChange={(e) => set("excluded", e.target.value)}
            />
          </label>
          <label>
            Site truncates at
            <input
              type="number"
              min="1"
              max="128"
              placeholder="No known truncation"
              value={r.truncates ?? ""}
              onChange={(e) =>
                set("truncates", e.target.value ? Number(e.target.value) : null)
              }
            />
          </label>
        </div>
        <div className="two-col">
          {(["minUpper", "minLower", "minNumbers", "minSymbols"] as const).map(
            (k, i) => (
              <label key={k}>
                {
                  [
                    "Minimum uppercase",
                    "Minimum lowercase",
                    "Minimum numbers",
                    "Minimum symbols",
                  ][i]
                }
                <input
                  type="number"
                  min="0"
                  max="128"
                  value={r[k]}
                  onChange={(e) => set(k, Number(e.target.value))}
                />
              </label>
            ),
          )}
        </div>
      </details>
      <label className="check">
        <input
          type="checkbox"
          checked={r.ambiguous}
          onChange={(e) => set("ambiguous", e.target.checked)}
        />
        Exclude look-alike characters (0/O, 1/l/I)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={r.noRepeat}
          onChange={(e) => set("noRepeat", e.target.checked)}
        />
        No consecutive repeated characters
      </label>
    </div>
  );
}
