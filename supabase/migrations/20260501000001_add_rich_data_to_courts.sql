-- Add rich data columns to courts table to support full JSON data import
ALTER TABLE public.courts 
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS opening_hours jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS reviews_data jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS popular_times jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS amenities jsonb DEFAULT '[]'::jsonb;

-- Ensure place_id is unique for upsert logic
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'courts_place_id_key'
    ) THEN
        ALTER TABLE public.courts ADD CONSTRAINT courts_place_id_key UNIQUE (place_id);
    END IF;
END $$;
