import { createClient } from '@supabase/supabase-js'

// Direct Supabase credentials - always use real values
const supabaseUrl = 'https://phsacjihxfuccnvvatos.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2FjamloeGZ1Y2NudnZhdG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwNjA4NzksImV4cCI6MjA4NjYzNjg3OX0.GfvrUMHk8alqQJSzayKeZ4hHL8yO5p4hAc5ARutPFbQ'

console.log('[Supabase] Initialized with real credentials')

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database
export interface PlanningEntry {
    id?: string
    vlomis_entry_id?: string
    date: string
    van: string
    tot: string
    registratiesoort: string
    medewerker: string
    functie: string
    afdeling: string
    vaartuig: string
    created_at?: string
    updated_at?: string
    last_scraped_at?: string
}
