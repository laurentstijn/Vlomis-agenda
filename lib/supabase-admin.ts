import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://phsacjihxfuccnvvatos.supabase.co'
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseServiceRoleKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY is missing. Admin tasks may fail with RLS enabled.')
}

// Create a Supabase client with the SERVICE ROLE key.
// This client bypasses Row Level Security (RLS) entirely.
// USE ONLY IN SERVER-SIDE CONTEXTS (API routes, cron jobs, scripts).
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
})
