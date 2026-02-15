import { createClient } from '@supabase/supabase-js'

// Get Supabase URL and key from environment variables ONLY
// No fallbacks - must be properly configured in Vercel
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] FATAL ERROR: Missing environment variables!')
  console.error('[Supabase] NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'loaded' : 'MISSING')
  console.error('[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? 'loaded' : 'MISSING')
  throw new Error('Supabase environment variables are not configured. Please verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in Vercel project settings.')
}

console.log('[Supabase] Successfully initialized with URL:', supabaseUrl)

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
