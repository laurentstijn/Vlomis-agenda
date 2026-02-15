import { createClient } from '@supabase/supabase-js'

// Get Supabase URL and key from environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Log for debugging
console.log('[Supabase] Initializing with URL:', supabaseUrl ? 'set' : 'MISSING')

let supabaseClient: any

if (!supabaseUrl || !supabaseAnonKey) {
    const missingVars = []
    if (!supabaseUrl) missingVars.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!supabaseAnonKey) missingVars.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    
    console.error('[Supabase] Missing environment variables:', missingVars.join(', '))
    console.error('[Supabase] The app cannot function without these. Please add them through the v0 Vars menu.')
    
    // Create a dummy client that will error when used
    supabaseClient = createClient('https://placeholder.supabase.co', 'placeholder-key')
} else {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
    console.log('[Supabase] Successfully initialized with real credentials')
}

export const supabase = supabaseClient

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
