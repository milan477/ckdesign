-- Run this in your Supabase SQL editor: https://zhoofyukimhrswkpczvh.supabase.co
-- Project > SQL Editor > New Query

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Collaboration Sessions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collaboration_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code    TEXT UNIQUE NOT NULL,
    creator_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    initial_concept TEXT NOT NULL,
    requirements    TEXT,
    status          TEXT NOT NULL DEFAULT 'active',  -- active | merging | completed
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Session Members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_members (
    session_id  UUID REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',       -- creator | member
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, user_id)
);

-- ─── Boards ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    elements    JSONB NOT NULL DEFAULT '[]',
    app_state   JSONB NOT NULL DEFAULT '{}',
    ck_nodes    JSONB NOT NULL DEFAULT '[]',
    version     INTEGER NOT NULL DEFAULT 1,
    pushed_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (session_id, user_id)
);

-- ─── Disable RLS for MVP (enable + add policies before production) ─────────────
ALTER TABLE users                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE collaboration_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE session_members        DISABLE ROW LEVEL SECURITY;
ALTER TABLE boards                 DISABLE ROW LEVEL SECURITY;

-- ─── Helper: auto-update updated_at on boards ────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER boards_updated_at
    BEFORE UPDATE ON boards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Merges ───────────────────────────────────────────────────────────────────
-- One merge record per collaboration session (overwritten on each new merge).
CREATE TABLE IF NOT EXISTS merges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID UNIQUE REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
    initiator_id    UUID REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'detecting',
    -- detecting → conflict_review → done
    merged_ck_state JSONB,          -- final merged CK state after completion
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER merges_updated_at
    BEFORE UPDATE ON merges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Merge Conflicts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merge_conflicts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_id        UUID REFERENCES merges(id) ON DELETE CASCADE,
    conflict_type   TEXT NOT NULL,  -- duplicate_concept | duplicate_knowledge | concept_rejected_by_knowledge | contradicting_concept
    step            INTEGER NOT NULL, -- currently 1 for the grouped merge-review step
    node_a          JSONB NOT NULL,  -- node from user A
    node_b          JSONB NOT NULL,  -- node from user B
    explanation     TEXT NOT NULL,   -- LLM explanation of the conflict
    resolution      JSONB,           -- suggested resolution + final user decision
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE merges          DISABLE ROW LEVEL SECURITY;
ALTER TABLE merge_conflicts DISABLE ROW LEVEL SECURITY;
