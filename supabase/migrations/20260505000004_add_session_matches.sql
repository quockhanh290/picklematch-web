-- Migration: Add session_matches table for granular match tracking
-- Created: 2026-05-05

CREATE TABLE IF NOT EXISTS public.session_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    team_a_no INTEGER NOT NULL,
    team_b_no INTEGER NOT NULL,
    score_a INTEGER DEFAULT 0,
    score_b INTEGER DEFAULT 0,
    court_no INTEGER,
    status TEXT NOT NULL DEFAULT 'playing', -- 'playing', 'finished', 'cancelled'
    players_snapshot JSONB, -- Stores { team_a: [ids], team_b: [ids] } for history
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.session_matches ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Session matches are viewable by everyone" 
ON public.session_matches FOR SELECT 
USING (true);

CREATE POLICY "Session matches are insertable by session host" 
ON public.session_matches FOR INSERT 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.sessions s 
        WHERE s.id = session_id AND s.host_id = auth.uid()
    )
);

CREATE POLICY "Session matches are updatable by session host" 
ON public.session_matches FOR UPDATE 
USING (
    EXISTS (
        SELECT 1 FROM public.sessions s 
        WHERE s.id = session_id AND s.host_id = auth.uid()
    )
);

-- Function to get matches with player names (optional but helpful)
CREATE OR REPLACE FUNCTION public.get_session_matches(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(m ORDER BY created_at DESC)
    INTO v_result
    FROM public.session_matches m
    WHERE m.session_id = p_session_id;
    
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
