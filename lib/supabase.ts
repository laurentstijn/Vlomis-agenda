import { createClient } from '@supabase/supabase-js'

// Get Supabase URL and key from environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        'Missing Supabase environment variables! ' +
        'Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set. ' +
        `Got: URL=${supabaseUrl ? 'set' : 'missing'}, KEY=${supabaseAnonKey ? 'set' : 'missing'}`
    )
}

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
