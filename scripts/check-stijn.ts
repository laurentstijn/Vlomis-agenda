import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.production.local') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
    // Find Luc's ID
    const { data: users, error: userErr } = await supabaseAdmin
        .from('users')
        .select('*');

    if (userErr || !users || users.length === 0) {
        console.error('Could not find users or DB error', userErr);
        return;
    }

    const luc = users.find(u =>
        (u.vlomis_username && u.vlomis_username.toLowerCase().includes('stijn')) ||
        (u.display_name && u.display_name.toLowerCase().includes('stijn'))
    );

    if (!luc) {
        console.log("Could not find any user matching 'stijn'. Users available:");
        console.log(users.map(u => ({ username: u.vlomis_username, display: u.display_name })));
        return;
    }
    console.log(`Found user: ${luc.vlomis_username} (ID: ${luc.id})`);

    if (!luc.google_access_token) {
        console.log("No google token for Luc.");
        return;
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
        access_token: luc.google_access_token,
        refresh_token: luc.google_refresh_token,
        expiry_date: luc.google_token_expiry ? new Date(luc.google_token_expiry).getTime() : undefined,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const calendarId = luc.google_calendar_id || 'primary';
    console.log(`Using calendar ID: ${calendarId}`);

    try {
        const res = await calendar.events.list({
            calendarId,
            maxResults: 50,
            showDeleted: false,
            singleEvents: true,
            orderBy: 'startTime',
            timeMin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
        });

        const events = res.data.items || [];
        const reports = events.filter(e => e.summary && (e.summary.includes('RAPPORT') || e.summary.includes('STATUS') || e.summary.includes('🔔') || e.summary.includes('📅')));

        console.log(`Found ${reports.length} report/status notifications in the last 7 days:`);
        reports.slice(0, 5).forEach((e, i) => {
            console.log(`\n--- Notification ${i + 1} ---`);
            console.log(`Created: ${e.created}`);
            console.log(`Start: ${e.start?.dateTime || e.start?.date}`);
            console.log(`Summary: ${e.summary}`);
            console.log(`Description: ${e.description?.substring(0, 100)}...`);
        });
    } catch (err) {
        console.error("Calendar error:", err);
    }
}

run();
