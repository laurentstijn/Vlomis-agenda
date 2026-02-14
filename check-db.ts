import { supabase } from './lib/supabase'

async function checkUsersTable() {
    console.log('Checking for users table...')

    const { data, error } = await supabase
        .from('users')
        .select('id')
        .limit(1)

    if (error) {
        if (error.code === '42P01') {
            console.log('Users table does NOT exist yet.')
        } else {
            console.error('Supabase error:', error)
        }
    } else {
        console.log('Users table exists!')
    }
}

checkUsersTable()
