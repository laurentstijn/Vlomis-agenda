-- Create planning_entries table to store Vlomis planning data
CREATE TABLE IF NOT EXISTS planning_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vlomis data fields
  vlomis_entry_id TEXT, -- Unique identifier from scraper (date + time + type)
  date DATE NOT NULL,
  van TIMESTAMPTZ NOT NULL,
  tot TIMESTAMPTZ NOT NULL,
  registratiesoort TEXT NOT NULL,
  
  -- Employee/function info
  medewerker TEXT NOT NULL,
  functie TEXT NOT NULL,
  afdeling TEXT NOT NULL,
  vaartuig TEXT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_scraped_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure no duplicate entries
  UNIQUE(medewerker, van, tot, registratiesoort)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_planning_entries_date ON planning_entries(date);
CREATE INDEX IF NOT EXISTS idx_planning_entries_medewerker ON planning_entries(medewerker);
CREATE INDEX IF NOT EXISTS idx_planning_entries_van ON planning_entries(van);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_planning_entries_updated_at 
    BEFORE UPDATE ON planning_entries 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
