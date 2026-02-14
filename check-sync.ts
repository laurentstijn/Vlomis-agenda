import { supabase } from './lib/supabase'

async function checkSyncStatus() {
    console.log('Checking sync status...')

    const { data: users, error } = await supabase
        .from('users')
        .select('id, vlomis_username, google_access_token, google_calendar_id, last_sync_at')

    if (error) {
        console.error('Error fetching users:', error)
    } else {
        console.log('Users found:', users)
    }
}

checkSyncStatus()
