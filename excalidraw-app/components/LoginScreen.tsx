import { useState } from "react";

import { login, signup, type AuthUser } from "../services/auth";

import "./LoginScreen.scss";

interface Props {
  onAuth: (user: AuthUser) => void;
}

export function LoginScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user =
        mode === "login"
          ? await login(username.trim(), password || undefined)
          : await signup(username.trim(), password || undefined);
      onAuth(user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ck-login">
      <div className="ck-login__card">
        <div className="ck-login__logo">
          <span className="ck-login__logo-c">C</span>
          <span className="ck-login__logo-k">K</span>
          <span className="ck-login__logo-word">Design</span>
        </div>
        <p className="ck-login__tagline">Collaborative concept-knowledge design</p>

        <div className="ck-login__tabs">
          <button
            className={`ck-login__tab ${mode === "login" ? "ck-login__tab--active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
            type="button"
          >
            Log in
          </button>
          <button
            className={`ck-login__tab ${mode === "signup" ? "ck-login__tab--active" : ""}`}
            onClick={() => { setMode("signup"); setError(""); }}
            type="button"
          >
            Sign up
          </button>
        </div>

        <form className="ck-login__form" onSubmit={handleSubmit}>
          <label className="ck-login__label">Username</label>
          <input
            className="ck-login__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your_username"
            autoFocus
            autoComplete="username"
            required
          />

          <label className="ck-login__label">
            Password
            <span className="ck-login__optional"> (optional)</span>
          </label>
          <div className="ck-login__password-row">
            <input
              className="ck-login__input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="leave blank for no password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            <button
              type="button"
              className="ck-login__show-btn"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {error && <p className="ck-login__error">{error}</p>}

          <button
            className="ck-login__submit"
            type="submit"
            disabled={loading || !username.trim()}
          >
            {loading ? "…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
