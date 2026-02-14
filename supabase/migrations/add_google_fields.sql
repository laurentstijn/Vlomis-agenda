-- Add Google Calendar fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS google_calendar_id TEXT DEFAULT 'primary';

-- Create an index to quickly find users with active google connections
CREATE INDEX IF NOT EXISTS idx_users_google_refresh_token ON users(google_refresh_token) WHERE google_refresh_token IS NOT NULL;
