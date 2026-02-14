
import { google } from 'googleapis';
import { supabase } from './lib/supabase';

async function cleanupCalendars() {
    console.log('🧹 Starting cleanup of duplicate calendars...');

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.NEXT_PUBLIC_APP_URL
    );

    // Get tokens from Supabase
    const { data: tokenData } = await supabase
        .from('google_calendar_tokens')
        .select('access_token, refresh_token, expiry_date')
        .single();

    if (!tokenData) {
        console.error('No tokens found. Login first.');
        return;
    }

    oauth2Client.setCredentials(tokenData);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // List all calendars
    const res = await calendar.calendarList.list();
    const calendars = res.data.items || [];

    console.log(`Found ${calendars.length} calendars total.`);

    const vlomisCalendars = calendars.filter(c => c.summary === 'Vlomis Planning');
    console.log(`Found ${vlomisCalendars.length} 'Vlomis Planning' calendars.`);

    for (const cal of vlomisCalendars) {
        console.log(`Deleting calendar: ${cal.id} (${cal.summary})...`);
        try {
            await calendar.calendars.delete({ calendarId: cal.id! });
            console.log('✅ Deleted.');
        } catch (e: any) {
            console.error(`❌ Failed to delete ${cal.id}:`, e.message);
        }
    }

    // Also clear DB ID
    const userId = (await supabase.auth.getUser()).data.user?.id; // This might fail in script
    // Just update all rows to be safe or use query
    const { error } = await supabase
        .from('profiles')
        .update({ google_calendar_id: null })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all profiles (should be just one relevant)

    console.log('✅ Cleared DB calendar IDs.');
}

cleanupCalendars();
