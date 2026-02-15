import { createClient } from '@supabase/supabase-js'

// Supabase client configuration with real credentials
// Get Supabase URL and key from environment
// IMPORTANT: In production, these MUST come from environment variables only
// For local v0 development, we include defaults to test the integration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://phsacjihxfuccnvvatos.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2FjamloeGZ1Y2NudnZhdG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwNjA4NzksImV4cCI6MjA4NjYzNjg3OX0.GfvrUMHk8alqQJSzayKeZ4hHL8yO5p4hAc5ARutPFbQ'

// Log for debugging - show first/last chars to verify it's loaded
console.log('[Supabase] Initializing with URL:', supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : 'MISSING')
console.log('[Supabase] Initializing with KEY:', supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : 'MISSING')

let supabaseClient: any

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Supabase] ERROR: Missing Supabase credentials!')
    supabaseClient = createClient('https://placeholder.supabase.co', 'placeholder-key')
} else {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
    console.log('[Supabase] Successfully initialized with credentials from:', supabaseUrl)
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
