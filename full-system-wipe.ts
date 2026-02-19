import { supabase } from './lib/supabase'
import { google } from 'googleapis'
import { getGoogleClientForUser } from './lib/google-calendar'

async function fullSystemWipe() {
    console.log('🧨 Starting Full System Wipe...')

    // 1. Get User
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('vlomis_username', 'laurenst')
        .single()

    if (!user) {
        console.error('❌ User "laurenst" not found!')
        return
    }

    console.log(`👤 Targeted User: ${user.vlomis_username} (${user.id})`)

    // 2. Delete Google Calendars
    try {
        console.log(`🧹 Cleaning up Google Calendars...`)
        const auth = await getGoogleClientForUser(user.id)
        const calendar = google.calendar({ version: 'v3', auth })

        const res = await calendar.calendarList.list()
        const calendars = res.data.items || []
        const vlomisCalendars = calendars.filter(c => c.summary === 'Vlomis Planning')

        for (const cal of vlomisCalendars) {
            if (cal.id) {
                console.log(`🗑️ Deleting calendar: ${cal.id}...`)
                await calendar.calendars.delete({ calendarId: cal.id })
            }
        }

        // Revoke token
        console.log('🚫 Revoking Google OAuth permissions...')
        await auth.revokeToken(user.google_access_token)
        console.log('✅ Google permissions revoked.')

    } catch (error: any) {
        console.log('⚠️ Google cleanup warning:', error.message)
    }

    // 3. Clear Planning Entries
    console.log('🗑️ Deleting all planning entries for user...')
    const { error: entriesError } = await supabase
        .from('planning_entries')
        .delete()
        .eq('user_id', user.id)

    if (entriesError) console.error('❌ Error deleting entries:', entriesError)
    else console.log('✅ Planning entries cleared.')

    // 4. Reset User Record
    console.log('🔄 Resetting user record to Day Zero...')
    const { error: userError } = await supabase
        .from('users')
        .update({
            google_access_token: null,
            google_refresh_token: null,
            google_token_expiry: null,
            google_calendar_id: null,
            last_sync_at: null,
            last_synced_at: null,
            vlomis_username: null,
            vlomis_password: null
        })
        .eq('id', user.id)

    if (userError) console.error('❌ Error resetting user:', userError)
    else console.log('✅ User record wiped. Back to login screen experience.')

    console.log('✨ Full Wipe Completed! Application is now in its initial state.')
}

fullSystemWipe()
