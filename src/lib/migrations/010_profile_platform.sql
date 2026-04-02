-- Add platform column to profiles table (default: 'Upwork')
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'Upwork';

-- Backfill existing profiles
UPDATE profiles SET platform = 'Upwork' WHERE platform IS NULL;
