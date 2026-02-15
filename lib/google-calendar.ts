import { google } from 'googleapis';
import { supabase } from './supabase';
import { AuthCredentials } from './auth-store';
import crypto from 'crypto';

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/api/auth/google/callback`
);

// Scopes for calendar access
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

export function getAuthUrl(userId: string) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // crucial for refresh token
    scope: SCOPES,
    prompt: 'consent', // force consent to ensure refresh token is returned
    state: userId, // pass user ID to callback
  });
}

export async function getTokensFromCode(code: string) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function saveGoogleTokens(userId: string, tokens: any) {
  const { access_token, refresh_token, expiry_date } = tokens;

  const updates: any = {
    google_access_token: access_token,
    google_token_expiry: new Date(expiry_date).toISOString(),
  };

  // Only update refresh token if returned (it's only returned on first consent)
  if (refresh_token) {
    updates.google_refresh_token = refresh_token;
  }

  const { error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId);

  if (error) throw error;
}

export async function getGoogleClientForUser(userId: string) {
  // Get tokens from DB
  const { data: user, error } = await supabase
    .from('users')
    .select('google_access_token, google_refresh_token, google_token_expiry, google_calendar_id')
    .eq('id', userId)
    .single();

  if (error || !user) throw new Error('User not found or no tokens');

  const userClient = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  userClient.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
    expiry_date: new Date(user.google_token_expiry).getTime(),
  });

  // Handle refresh if needed (googleapis handles this automatically if refresh_token is set)
  // But we might want to listen to token events to update DB
  userClient.on('tokens', async (tokens) => {
    await saveGoogleTokens(userId, tokens);
  });

  return userClient;
}

export async function syncEventsToCalendar(userId: string, events: any[]) {
  try {
    const auth = await getGoogleClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    // Get or create dedicated calendar
    let calendarId = 'primary';

    // Check if we already have a stored calendar ID that is NOT primary
    const { data: userData } = await supabase
      .from('users')
      .select('google_calendar_id')
      .eq('id', userId)
      .single();

    if (userData?.google_calendar_id && userData.google_calendar_id !== 'primary') {
      try {
        // Verify the calendar still exists
        await calendar.calendars.get({ calendarId: userData.google_calendar_id });
        calendarId = userData.google_calendar_id;
      } catch (err: any) {
        if (err.code === 404) {
          console.log('Stored calendar ID not found (manual deletion?), resetting...');
          calendarId = 'primary'; // reset to trigger search/create below
        } else {
          throw err;
        }
      }
    }

    if (calendarId === 'primary') {
      // Check if "Vlomis Planning" already exists in user's calendar list
      try {
        const calendarList = await calendar.calendarList.list();
        const existingCalendar = calendarList.data.items?.find(
          c => c.summary === 'Vlomis Planning'
        );

        if (existingCalendar?.id) {
          calendarId = existingCalendar.id;
        } else {
          // Create new calendar
          console.log('Creating new Vlomis Planning calendar...');
          const newCalendar = await calendar.calendars.insert({
            requestBody: {
              summary: 'Vlomis Planning',
              description: 'Automatische planning van Vlomis',
              timeZone: 'Europe/Brussels'
            }
          });

          if (newCalendar.data.id) {
            calendarId = newCalendar.data.id;
          }
        }

        // Save this ID to the user record for future use
        if (calendarId !== 'primary') {
          await supabase
            .from('users')
            .update({ google_calendar_id: calendarId })
            .eq('id', userId);
        }
      } catch (err) {
        console.error('Error finding/creating calendar, falling back to primary:', err);
        calendarId = 'primary';
      }
    }

    // For each planning entry from Vlomis
    for (const entry of events) {
      // User request: Filter out 'Reserve' and 'Rust' (skip them)
      const type = entry.registratiesoort || '';
      if (type.includes('Reserve') || type.includes('Rust')) {
        continue;
      }

      // Add a small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));

      const eventId = crypto.createHash('sha256').update(entry.vlomis_entry_id).digest('hex');

      // Determine if it has specific hours (not 00:00 - 00:00)
      const hasSpecificHours = !entry.van.includes('T00:00:00');

      let summary = type;

      if (hasSpecificHours) {
        // Format: "Dagdienst - Zeeschelde (08:00 - 20:00)"
        // Extract hours (use UTC to get "face value" since we stored it as UTC)
        const formatTime = (isoString: string) => {
          if (!isoString) return '';
          const date = new Date(isoString);
          return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
        };
        const timeRange = `${formatTime(entry.van)} - ${formatTime(entry.tot)}`;

        // Add Vessel and Time to title
        summary = `${type} - ${entry.vaartuig || entry.functie} (${timeRange})`;
      } else {
        // For non-timed events (like Verlof), just keep the type or maybe type + vessel if relevant?
        // User said: "enkel met de scheepsnaam erbij als er uren zijn ingevuld"
        // So for Verlof (which is usually all day), we likely just want "Verlof"
        // But let's check if Verlof has a vessel? Usually not.
        if (entry.vaartuig) {
          // Maybe user wants vessel for Verlof too? "als er uren zijn ingevuld" implies conditional.
          // Let's stick to strict interpretation: No vessel in title if no hours.
          summary = type;
        }
      }

      // Special case for "Verlof" - we can't detect "pending" (trash can) reliable from current scraper
      // as we don't scrape attributes. We'll leave it as is for now or maybe mark all as "Verlof"

      const description = `
        Vaartuig: ${entry.vaartuig}
        Functie: ${entry.functie}
        Afdeling: ${entry.afdeling}
        Type: ${entry.registratiesoort}
      `.trim();

      // Map Vlomis types to Google Calendar colors (approximate)
      // User request 14/02: "kan ik de google agenda alles een kleur hebben"
      // We will now REMOVE specific colorIds so events inherit the CALENDAR's color.
      // This allows the user to pick one color for the whole "Vlomis Planning" calendar in Google UI.

      /* 
      // PREVIOUS COLOR LOGIC (Disabled for uniformity)
      let colorId = '8'; // Default Graphite
      if (type.includes('Dagdienst')) colorId = '10'; // Green
      else if (type.includes('Reserve')) colorId = '6'; // Orange/Yellow-ish
      else if (type.includes('Rust')) colorId = '8'; // Gray
      else if (type.includes('Ziekte')) colorId = '11'; // Red
      else if (type.includes('Verlof')) colorId = '7'; // Blue
      else if (type.includes('Vorming')) colorId = '3'; // Purple
      */

      // Check for All-Day event
      // User requested ALL events to be all-day
      const isAllDay = true; // entry.van.includes('T00:00:00') && entry.tot.includes('T00:00:00');

      let start: any, end: any;
      if (isAllDay) {
        // For all day, use YYYY-MM-DD
        // entry.van is '2026-03-23T00:00:00+00:00' -> split to get date
        start = { date: entry.van.split('T')[0] };

        // Google Calendar end date for all-day is exclusive (next day)
        // Check if data from Vlomis is already next day or same day.
        // Usually Vlomis 'tot' for a single day 'Reserve' is the NEXT day 00:00.
        // e.g. van 23/03 00:00, tot 24/03 00:00 -> This is exactly 1 day.
        end = { date: entry.tot.split('T')[0] };

        // If van and tot date strings are same, we must bump tot by 1 day for Google
        if (start.date === end.date) {
          const dt = new Date(entry.tot);
          dt.setDate(dt.getDate() + 1);
          end = { date: dt.toISOString().split('T')[0] };
        }
      } else {
        start = { dateTime: entry.van };
        end = { dateTime: entry.tot };
      }

      const eventResource = {
        summary,
        description,
        start,
        end,
        // colorId, // Disabled to use default calendar color
        id: eventId, // Try to reuse ID to update existing events
        reminders: {
          useDefault: true,
        },
      };

      try {
        // Try to insert (will fail if ID exists)
        await calendar.events.insert({
          calendarId,
          requestBody: eventResource,
        });
        console.log(`Created event: ${summary}`);
      } catch (e: any) {
        if (e.code === 409) {
          // Event exists, update it
          try {
            await calendar.events.update({
              calendarId,
              eventId: eventResource.id,
              requestBody: eventResource,
            });
            console.log(`Updated event: ${summary}`);
          } catch (updateErr) {
            console.error(`Error updating event ${eventId}:`, updateErr);
          }
        } else {
          console.error(`Error inserting event ${eventId}:`, e);
        }
      }
    }
  } catch (error) {
    console.error('Error syncing to calendar:', error);
    throw error;
  }
}
