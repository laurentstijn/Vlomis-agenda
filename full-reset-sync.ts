import { supabase } from './lib/supabase'
import { google } from 'googleapis'
import { getGoogleClientForUser, syncEventsToCalendar } from './lib/google-calendar'

async function fullResetAndSync() {
    console.log('🔄 Starting Full Reset & Sync...')

    // 1. Get User
    const { data: user } = await supabase
        .from('users')
        .select('id, vlomis_username, google_calendar_id')
        .single()

    if (!user) {
        console.error('❌ No user found!')
        return
    }

    console.log(`👤 User: ${user.vlomis_username}`)

    // 2. Delete ALL existing "Vlomis Planning" calendars to prevent duplicates
    try {
        console.log(`🧹 Checking for old/duplicate calendars...`)
        const auth = await getGoogleClientForUser(user.id)
        const calendar = google.calendar({ version: 'v3', auth })

        // List all calendars
        const res = await calendar.calendarList.list()
        const calendars = res.data.items || []

        // Find all with name "Vlomis Planning"
        const vlomisCalendars = calendars.filter(c => c.summary === 'Vlomis Planning')

        if (vlomisCalendars.length > 0) {
            console.log(`Found ${vlomisCalendars.length} 'Vlomis Planning' calendars. Deleting all...`)
            for (const cal of vlomisCalendars) {
                if (cal.id) {
                    try {
                        console.log(`🗑️ Deleting ${cal.id}...`)
                        await calendar.calendars.delete({ calendarId: cal.id })
                    } catch (err: any) {
                        console.error(`⚠️ Failed to delete ${cal.id}: ${err.message}`)
                    }
                }
            }
        } else {
            console.log('✅ No old calendars found.')
        }

    } catch (error: any) {
        console.log('⚠️ Error searching/deleting calendars:', error.message)
    }

    // 3. Reset ID in Database
    await supabase
        .from('users')
        .update({ google_calendar_id: null })
        .eq('id', user.id)
    console.log('✅ Database calendar ID cleared')

    // 4. Get Data
    const { data: entries, count } = await supabase
        .from('planning_entries')
        .select('*')
        .eq('user_id', user.id)

    if (!entries || entries.length === 0) {
        console.log('⚠️ No entries to sync.')
        return
    }

    console.log(`📅 Found ${entries.length} entries to sync.`)

    // 4.5. Deduplicate Data
    const pending = entries.filter(e => e.registratiesoort && e.registratiesoort.includes('(Aangevraagd)'));
    if (pending.length > 0) {
        console.log(`🧹 Found ${pending.length} pending items. removing duplicates from DB...`);
        for (const p of pending) {
            const baseType = p.registratiesoort.replace(' (Aangevraagd)', '');
            await supabase.from('planning_entries').delete().match({
                user_id: user.id,
                medewerker: p.medewerker,
                van: p.van,
                registratiesoort: baseType
            });
        }
        // Remove deleted items from local 'entries' list so we don't sync them
        // We can filter the array
        const baseTypesToDelete = pending.map(p => ({
            van: p.van,
            type: p.registratiesoort.replace(' (Aangevraagd)', '')
        }));

        // Filter out items that match the base types
        for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            if (baseTypesToDelete.some(del => del.van === e.van && del.type === e.registratiesoort)) {
                entries.splice(i, 1);
            }
        }
        console.log(`✅ Removed duplicates. syncing ${entries.length} unique entries.`);
    }

    // 5. Re-Sync (This will create a new calendar and add events)
    console.log('🚀 Starting sync (this may take a while)...')
    try {
        await syncEventsToCalendar(user.id, entries)
        console.log('✨ Full Reset & Sync Completed Successfully!')
    } catch (error) {
        console.error('❌ Sync failed:', error)
    }
}

fullResetAndSync()
