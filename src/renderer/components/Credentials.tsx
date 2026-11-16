import { useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Hash,
  MessageCircle,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  QUESTIONS,
  type Credentials as Values,
  type Factors,
} from "../../shared/types";
export const emptyCredentials = (): Values => ({
  password: "",
  pin: "",
  answers: ["", "", ""],
});
export const defaultFactors = (): Factors => ({
  password: true,
  pin: false,
  questions: [],
  bound: false,
});
export function Credentials({
  factors,
  value,
  onChange,
  setup = false,
  onFactors,
}: {
  factors: Factors;
  value: Values;
  onChange: (v: Values) => void;
  setup?: boolean;
  onFactors?: (f: Factors) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [confirm, setConfirm] = useState("");
  const strength = Math.min(
    4,
    Number(value.password.length >= 12) +
      Number(value.password.length >= 18) +
      Number(/[a-z]/.test(value.password) && /[A-Z]/.test(value.password)) +
      Number(
        /[0-9]/.test(value.password) && /[^a-zA-Z0-9]/.test(value.password),
      ),
  );
  const update = (key: "password" | "pin", v: string) =>
    onChange({ ...value, [key]: v });
  return (
    <div className="credentials">
      {setup && (
        <p className="muted small">
          Choose at least one group. Every group you enable is required to
          unlock.
        </p>
      )}
      {(["password", "pin", "questions"] as const).map((type, i) => {
        const enabled =
          type === "questions" ? !!factors.questions.length : factors[type];
        const Icon = [KeyRound, Hash, MessageCircle][i];
        return (
          <section className={`factor ${enabled ? "enabled" : ""}`} key={type}>
            <div className="factor-title">
              <span>
                <Icon size={17} />
                {["Master password", "Numeric PIN", "Security questions"][i]}
              </span>
              {setup ? (
                <label className="check">
                  <span className="recommended">Recommended</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) =>
                      onFactors?.({
                        ...factors,
                        [type]:
                          type === "questions"
                            ? e.target.checked
                              ? QUESTIONS.slice(0, 3)
                              : []
                            : e.target.checked,
                      })
                    }
                  />
                </label>
              ) : null}
            </div>
            {enabled && (
              <div className="factor-fields">
                {type === "questions" ? (
                  <>
                    {factors.questions.map((question, index) => (
                      <label key={index}>
                        {setup ? (
                          <select
                            aria-label={`Security question ${index + 1}`}
                            value={question}
                            onChange={(e) => {
                              const questions = [...factors.questions];
                              questions[index] = e.target.value;
                              onFactors?.({ ...factors, questions });
                            }}
                          >
                            {QUESTIONS.map((q) => (
                              <option
                                key={q}
                                disabled={
                                  factors.questions.includes(q) &&
                                  q !== question
                                }
                              >
                                {q}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{question}</span>
                        )}
                        <input
                          autoComplete="off"
                          type={visible ? "text" : "password"}
                          value={value.answers[index] || ""}
                          placeholder="Your answer"
                          onChange={(e) => {
                            const answers = [...value.answers];
                            answers[index] = e.target.value;
                            onChange({ ...value, answers });
                          }}
                          required
                        />
                      </label>
                    ))}
                    <p className="muted small">
                      An extra credential group, never a recovery method or
                      bypass.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="input-action">
                      <input
                        autoFocus={type === "password"}
                        aria-label={
                          type === "password" ? "Master password" : "PIN"
                        }
                        autoComplete={
                          setup ? "new-password" : "current-password"
                        }
                        type={visible ? "text" : "password"}
                        inputMode={type === "pin" ? "numeric" : undefined}
                        maxLength={type === "pin" ? 12 : 4096}
                        value={value[type]}
                        onChange={(e) => update(type, e.target.value)}
                        placeholder={
                          type === "password"
                            ? "Enter your master password"
                            : "6–12 digits"
                        }
                        required
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={
                          visible ? "Hide credentials" : "Show credentials"
                        }
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {setup && type === "password" && (
                      <>
                        <div className="strength">
                          {[1, 2, 3, 4].map((n) => (
                            <i
                              key={n}
                              className={n <= strength ? "filled" : ""}
                            />
                          ))}
                        </div>
                        <p className="muted small">
                          {value.password.length
                            ? strength >= 3
                              ? "Looking strong."
                              : "A longer, unique password is safer."
                            : "12 or more characters recommended."}
                        </p>
                        <input
                          type={visible ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder="Confirm master password"
                          aria-label="Confirm master password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          required
                          pattern={undefined}
                        />
                        {confirm && confirm !== value.password && (
                          <p className="warning small">
                            Passwords do not match.
                          </p>
                        )}
                        <input
                          tabIndex={-1}
                          aria-hidden
                          className="validation-input"
                          value={confirm === value.password ? "match" : ""}
                          onChange={() => {}}
                          required
                          title="Confirm your master password"
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        );
      })}
      {factors.questions.length > 0 && !factors.password && !factors.pin && (
        <button
          type="button"
          className="text-button"
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Hide answers" : "Show answers"}
        </button>
      )}
      {setup && (
        <>
          <p className="notice">
            <AlertTriangle size={16} />
            {factors.password && factors.pin && factors.questions.length === 3
              ? "Keep every credential safe. There is no password recovery."
              : "Less protected: enable all three groups for the recommended setup. A PIN or answers alone are easier to guess."}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={factors.bound}
              onChange={(e) =>
                onFactors?.({ ...factors, bound: e.target.checked })
              }
            />
            Bind to this computer
          </label>
          {factors.bound && (
            <p className="warning small">
              This vault and its backups require this computer’s OS keychain.
              Export a portable backup with a separate passphrase to use another
              computer.
            </p>
          )}
        </>
      )}
    </div>
  );
}
