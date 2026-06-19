ALTER TABLE session_player_state
  ADD COLUMN IF NOT EXISTS effective_pvna NUMERIC(4,2) NULL;

CREATE TABLE IF NOT EXISTS session_avoid_pairs (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_a   UUID NOT NULL,
  player_b   UUID NOT NULL,
  reason     TEXT,
  PRIMARY KEY (session_id, player_a, player_b),
  CONSTRAINT chk_avoid_order CHECK (player_a < player_b)
);

ALTER TABLE session_avoid_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_avoid_pairs_select"
  ON session_avoid_pairs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_avoid_pairs.session_id
        AND sessions.host_id = auth.uid()
    )
  );

CREATE POLICY "session_avoid_pairs_insert"
  ON session_avoid_pairs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_avoid_pairs.session_id
        AND sessions.host_id = auth.uid()
    )
  );

CREATE POLICY "session_avoid_pairs_delete"
  ON session_avoid_pairs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_avoid_pairs.session_id
        AND sessions.host_id = auth.uid()
    )
  );
