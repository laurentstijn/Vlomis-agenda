
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const supabase = createClient('https://phsacjihxfuccnvvatos.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2FjamloeGZ1Y2NudnZhdG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwNjA4NzksImV4cCI6MjA4NjYzNjg3OX0.GfvrUMHk8alqQJSzayKeZ4hHL8yO5p4hAc5ARutPFbQ');

async function checkCalendar() {
    // 1. Get tokens
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .ilike('vlomis_username', 'laurenst')
        .single();

    if (!user || !user.google_access_token) {
        console.error('User not found or not connected');
        return;
    }

    // 2. Setup Google Client
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
        access_token: user.google_access_token,
        refresh_token: user.google_refresh_token,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = user.google_calendar_id || 'primary';

    console.log(`Checking calendar: ${calendarId}`);

    // 3. List events today
    const response = await calendar.events.list({
        calendarId,
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
    });

    const events = response.data.items || [];
    console.log(`Found ${events.length} upcoming events.`);
    events.forEach(event => {
        console.log(`- [${event.start?.dateTime || event.start?.date}] ${event.summary} (ID: ${event.id})`);
        if (event.reminders) {
            console.log(`  Reminders:`, JSON.stringify(event.reminders));
        }
    });
}

checkCalendar();
