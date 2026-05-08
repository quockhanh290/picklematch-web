-- Migration: Court Owner Flow Implementation
-- Created: 2024-05-04
-- Purpose: Setup the separate owners table and update courts/sessions for business management.

-- 1. Create Owners Table
CREATE TABLE IF NOT EXISTS owners (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Update Courts Table
-- Adds reference to owners and physical capacity configuration
ALTER TABLE courts ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES owners(id);
ALTER TABLE courts ADD COLUMN IF NOT EXISTS sub_court_count INTEGER DEFAULT 1;

-- 3. Update Sessions Table
-- Adds format types (social vs round robin) and sub-court utilization
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS format_type TEXT DEFAULT 'social';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sub_courts_used INTEGER DEFAULT 1;

-- 4. Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_courts_owner_id ON courts(owner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_format_type ON sessions(format_type);

-- 5. Row Level Security (RLS)
-- Enable RLS on owners table
ALTER TABLE owners ENABLE ROW LEVEL SECURITY;

-- Policy: Owners can read/write their own profile
CREATE POLICY "Owners can view their own profile" 
ON owners FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Owners can update their own profile" 
ON owners FOR UPDATE 
USING (auth.uid() = id);

CREATE POLICY "Users can register as owners" 
ON owners FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Policy: Owners can update their claimed courts
CREATE POLICY "Owners can update their own courts" 
ON courts FOR UPDATE 
USING (auth.uid() = owner_id);

-- 6. Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_owners_updated_at
    BEFORE UPDATE ON owners
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
