import { useEffect, useState } from "react";

import { getStoredSession, getStoredUser, storeSession, type AuthUser, type SessionInfo } from "./services/auth";
import { STORAGE_KEYS } from "./app_constants";
import { LoginScreen } from "./components/LoginScreen";
import { SessionManager } from "./components/SessionManager";
import { MergeWorkspace } from "./components/MergeWorkspace";
import ExcalidrawApp from "./App";

export default function AppRoot() {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);
  const [session, setSession] = useState<SessionInfo | null>(getStoredSession);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Listen for merge trigger dispatched from CKAgentPanel
  useEffect(() => {
    const handler = () => setMergeOpen(true);
    window.addEventListener("ck-merge-requested", handler);
    return () => window.removeEventListener("ck-merge-requested", handler);
  }, []);

  // Listen for back-to-boards trigger dispatched from CKAgentPanel
  useEffect(() => {
    const handler = () => setSession(null);
    window.addEventListener("ck-back-to-boards", handler);
    return () => window.removeEventListener("ck-back-to-boards", handler);
  }, []);

  if (!user) {
    return (
      <LoginScreen
        onAuth={(u) => {
          setUser(u);
          setSession(null);
        }}
      />
    );
  }

  if (!session) {
    return (
      <SessionManager
        user={user}
        onSession={(s) => {
          // Ensure getStoredSession() always returns the correct board,
          // and wipe stale canvas data before ExcalidrawApp mounts.
          storeSession(s);
          localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS);
          localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_APP_STATE);
          setSession(s);
        }}
        onLogout={() => {
          setUser(null);
          setSession(null);
        }}
      />
    );
  }

  return (
    <>
      <ExcalidrawApp />
      {mergeOpen && (
        <MergeWorkspace
          onClose={() => setMergeOpen(false)}
          onMergeComplete={(_mergedState) => {
            // TODO: pass merged CK state back into CKAgentPanel via custom event
            window.dispatchEvent(new CustomEvent("ck-merge-apply", { detail: { mergedState: _mergedState } }));
            setMergeOpen(false);
          }}
        />
      )}
    </>
  );
}
