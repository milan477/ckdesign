import { useEffect, useState } from "react";

import { clearUser, type AuthUser, type SessionInfo } from "../services/auth";
import { createSession, getMySessions, joinSession } from "../services/sessions";

import "./SessionManager.scss";

interface Props {
  user: AuthUser;
  onSession: (session: SessionInfo) => void;
  onLogout: () => void;
}

type View = "home" | "create" | "join";

export function SessionManager({ user, onSession, onLogout }: Props) {
  const [view, setView] = useState<View>("home");
  const [mySessions, setMySessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [concept, setConcept] = useState("");
  const [requirements, setRequirements] = useState("");
  const [sessionCode, setSessionCode] = useState("");

  useEffect(() => {
    getMySessions()
      .then(setMySessions)
      .catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await createSession(concept.trim(), requirements.trim() || undefined);
      onSession(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await joinSession(sessionCode.toUpperCase());
      onSession(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearUser();
    onLogout();
  };

  const goBack = () => {
    setView("home");
    setError("");
  };

  return (
    <div className="ck-sm">
      <header className="ck-sm__header">
        <div className="ck-sm__logo">
          <span className="ck-sm__logo-c">C</span>
          <span className="ck-sm__logo-k">K</span>
          <span className="ck-sm__logo-word">Design</span>
        </div>
        <div className="ck-sm__user-row">
          <span className="ck-sm__username">@{user.username}</span>
          <button className="ck-sm__logout" onClick={handleLogout} type="button">
            Log out
          </button>
        </div>
      </header>

      <main className="ck-sm__main">
        {view === "home" && (
          <>
            <div className="ck-sm__cta-row">
              <button
                className="ck-sm__cta ck-sm__cta--primary"
                onClick={() => setView("create")}
                type="button"
              >
                <span className="ck-sm__cta-icon">＋</span>
                <div>
                  <div className="ck-sm__cta-title">Start new session</div>
                  <div className="ck-sm__cta-sub">Define a concept and invite a collaborator</div>
                </div>
              </button>

              <button
                className="ck-sm__cta ck-sm__cta--secondary"
                onClick={() => setView("join")}
                type="button"
              >
                <span className="ck-sm__cta-icon">→</span>
                <div>
                  <div className="ck-sm__cta-title">Join existing session</div>
                  <div className="ck-sm__cta-sub">Enter a session code to collaborate</div>
                </div>
              </button>
            </div>

            {mySessions.length > 0 && (
              <section className="ck-sm__sessions">
                <h2 className="ck-sm__section-title">Your sessions</h2>
                <div className="ck-sm__list">
                  {mySessions.map((s) => (
                    <div
                      key={s.id}
                      className="ck-sm__item"
                      onClick={() => onSession(s)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && onSession(s)}
                    >
                      <div className="ck-sm__item-concept">{s.initial_concept}</div>
                      <div className="ck-sm__item-meta">
                        <span className="ck-sm__item-code">{s.session_code}</span>
                        <span className={`ck-sm__item-role ck-sm__item-role--${s.role}`}>
                          {s.role}
                        </span>
                        <span className={`ck-sm__item-status ck-sm__item-status--${s.status}`}>
                          {s.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {view === "create" && (
          <div className="ck-sm__form-wrap">
            <button className="ck-sm__back" onClick={goBack} type="button">
              ← Back
            </button>
            <h2 className="ck-sm__form-title">Start a new session</h2>

            <form className="ck-sm__form" onSubmit={handleCreate}>
              <label className="ck-sm__label">
                Initial concept <span className="ck-sm__required">*</span>
              </label>
              <input
                className="ck-sm__input"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="e.g. Sustainable urban mobility"
                required
                autoFocus
              />

              <label className="ck-sm__label">Requirements / description</label>
              <textarea
                className="ck-sm__textarea"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="Describe the design challenge, constraints, or goals…"
                rows={4}
              />

              {error && <p className="ck-sm__error">{error}</p>}

              <button
                className="ck-sm__submit"
                type="submit"
                disabled={loading || !concept.trim()}
              >
                {loading ? "Creating…" : "Create session"}
              </button>
            </form>
          </div>
        )}

        {view === "join" && (
          <div className="ck-sm__form-wrap">
            <button className="ck-sm__back" onClick={goBack} type="button">
              ← Back
            </button>
            <h2 className="ck-sm__form-title">Join a session</h2>

            <form className="ck-sm__form" onSubmit={handleJoin}>
              <label className="ck-sm__label">
                Session code <span className="ck-sm__required">*</span>
              </label>
              <input
                className="ck-sm__input ck-sm__input--code"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB3X7Q"
                maxLength={6}
                required
                autoFocus
                spellCheck={false}
              />
              <p className="ck-sm__hint">Ask your collaborator for the 6-character code</p>

              {error && <p className="ck-sm__error">{error}</p>}

              <button
                className="ck-sm__submit"
                type="submit"
                disabled={loading || sessionCode.length < 6}
              >
                {loading ? "Joining…" : "Join session"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
