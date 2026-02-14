import { supabase } from './lib/supabase'

async function checkPlanningAndSync() {
    console.log('Checking planning entries...')

    // Get the user
    const { data: user } = await supabase
        .from('users')
        .select('id, vlomis_username')
        .single()

    if (!user) {
        console.error('No user found!')
        return
    }

    // Get entries
    const { data: entries, count } = await supabase
        .from('planning_entries')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)

    console.log(`Found ${count} planning entries for user ${user.vlomis_username}`)

    if (count && count > 0) {
        console.log('First 3 entries:', entries.slice(0, 3))

        // Now try to sync manually
        console.log('Attempting manual sync...')
        try {
            const { syncEventsToCalendar } = await import('./lib/google-calendar')
            await syncEventsToCalendar(user.id, entries)
            console.log('Manual sync completed!')
        } catch (err) {
            console.error('Manual sync failed:', err)
        }
    } else {
        console.log('No entries to sync. That explains why the calendar is empty!')
    }
}

checkPlanningAndSync()
