-- Table for sessions managed specifically by court owners
CREATE TABLE IF NOT EXISTS owner_sessions (
  id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  court_id UUID REFERENCES courts(id) NOT NULL,
  
  -- Specific Owner Fields
  format_type TEXT NOT NULL DEFAULT 'social', -- 'social', 'round_robin', 'open_play', 'tournament'
  sub_court_numbers INTEGER[] DEFAULT '{1}', -- [1, 2] means this session uses court #1 and #2
  
  -- Registration Logic
  is_unlimited BOOLEAN DEFAULT false,
  custom_max_players INTEGER, -- If not unlimited
  
  -- Flexible Metadata for different formats
  -- Social: { "level_focus": "fun", "balls_provided": true }
  -- Round Robin: { "pool_count": 4, "points_to_win": 15, "teams_per_pool": 4 }
  format_metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for owner_sessions
ALTER TABLE owner_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage their own session details"
ON owner_sessions FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM courts 
    WHERE courts.id = owner_sessions.court_id 
    AND courts.owner_id = auth.uid()
  )
);

CREATE POLICY "Everyone can view owner session details"
ON owner_sessions FOR SELECT
TO authenticated
USING (true);
