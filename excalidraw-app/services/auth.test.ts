import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearUser,
  getStoredSession,
  getStoredUser,
  storeSession,
  storeUser,
  type AuthUser,
  type SessionInfo,
} from "./auth";

const user: AuthUser = {
  id: "user-a",
  username: "alice",
  token: "token-a",
};

const session: SessionInfo = {
  id: "session-a",
  session_code: "ABC123",
  initial_concept: "Concept",
  requirements: null,
  status: "active",
  role: "creator",
  created_at: "2026-09-04T00:00:00Z",
};

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("CK auth storage", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("keeps the active account and board session tab-local", () => {
    storeUser(user);
    storeSession(session);

    expect(getStoredUser()).toEqual(user);
    expect(getStoredSession()).toEqual(session);
    expect(sessionStorage.getItem("ck_auth_user")).not.toBeNull();
    expect(sessionStorage.getItem("ck_auth_session")).not.toBeNull();
    expect(localStorage.getItem("ck_auth_user")).toBeNull();
    expect(localStorage.getItem("ck_auth_session")).toBeNull();
  });

  it("migrates legacy cross-tab state only once", () => {
    localStorage.setItem("ck_auth_user", JSON.stringify(user));

    expect(getStoredUser()).toEqual(user);
    expect(sessionStorage.getItem("ck_auth_user")).toBe(JSON.stringify(user));
    expect(localStorage.getItem("ck_auth_user")).toBeNull();
  });

  it("clears both current and legacy storage", () => {
    storeUser(user);
    storeSession(session);
    localStorage.setItem("ck_auth_user", JSON.stringify(user));
    localStorage.setItem("ck_auth_session", JSON.stringify(session));

    clearUser();

    expect(getStoredUser()).toBeNull();
    expect(getStoredSession()).toBeNull();
  });
});
