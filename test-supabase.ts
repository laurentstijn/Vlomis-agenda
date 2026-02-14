// Test Supabase connection
import { supabase } from './lib/supabase'

async function testConnection() {
    console.log('Testing Supabase connection...')
    console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
    console.log('Key:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET' : 'NOT SET')

    const { data, error } = await supabase
        .from('planning_entries')
        .select('count')
        .limit(1)

    if (error) {
        console.error('Supabase error:', error)
    } else {
        console.log('Supabase connection successful!', data)
    }
}

testConnection()
