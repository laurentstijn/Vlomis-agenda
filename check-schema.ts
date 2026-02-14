import { supabase } from './lib/supabase'

async function checkSchema() {
    console.log('Checking database schema...')

    const { data, error } = await supabase
        .from('users')
        .select('google_access_token')
        .limit(1)

    if (error) {
        console.log('Error accessing google_access_token column:', error.message)
        console.log('Migration likely NOT applied.')
    } else {
        console.log('Success! google_access_token column exists.')
    }
}

checkSchema()
