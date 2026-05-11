-- Migration: Add DELETE policy for session_matches (was missing)
-- Created: 2026-05-11

CREATE POLICY "Session matches are deletable by session host"
ON public.session_matches FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id = session_id AND s.host_id = auth.uid()
    )
);
