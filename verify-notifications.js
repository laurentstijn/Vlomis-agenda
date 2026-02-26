require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

const supabase = createClient(
  'https://phsacjihxfuccnvvatos.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('vlomis_username', 'laurenst')
    .single();

  if (error || !user) {
    console.error("User not found");
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
    expiry_date: new Date(user.google_token_expiry).getTime(),
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const calId = user.google_calendar_id || 'primary';

  try {
    const res = await calendar.events.list({
      calendarId: calId,
      timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Laatste 24 uur
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const notifications = res.data.items.filter(ev => ev.summary && (ev.summary.includes('RAPPORT') || ev.summary.includes('🔔')));
    
    console.log(`\nMeldingen gevonden in kalender '${calId}' voor 'laurenst' (laatste 24u):`);
    if (notifications.length > 0) {
      notifications.forEach(n => {
        console.log(`[${new Date(n.created).toLocaleString('nl-BE')}] ${n.summary}`);
      });
    } else {
      console.log("Geen nieuwe meldingen (RAPPORT events) gevonden.");
      console.log("Dit betekent waarschijnlijk dat er vannacht geen veranderingen waren in je Vlomis rooster t.o.v. gisterenmiddag.");
    }

  } catch (err) {
    console.error("Google API Fout:", err.message);
  }
}

check();
