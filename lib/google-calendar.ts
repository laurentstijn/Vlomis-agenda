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

export async function syncEventsToCalendar(userId: string, events: any[], limit: number = 40) {
  try {
    console.log(`[syncEventsToCalendar] Starting sync for user ${userId} with ${events.length} events`);

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

    console.log(`[syncEventsToCalendar] User data retrieved, current calendarId: ${userData?.google_calendar_id || 'none'}`);

    if (userData?.google_calendar_id && userData.google_calendar_id !== 'primary') {
      try {
        // Verify the calendar still exists
        await calendar.calendars.get({ calendarId: userData.google_calendar_id });
        calendarId = userData.google_calendar_id;
        console.log(`[syncEventsToCalendar] Using existing calendar: ${calendarId}`);
      } catch (err: any) {
        if (err.code === 404) {
          console.log('[syncEventsToCalendar] Stored calendar ID not found (manual deletion?), resetting...');
          calendarId = 'primary'; // reset to trigger search/create below
        } else {
          throw err;
        }
      }
    }

    if (calendarId === 'primary' || !calendarId) {
      // Check if "Vlomis Planning" already exists in user's calendar list
      try {
        console.log('[Sync] Searching for dedicated Vlomis Planning calendar...');
        const calendarList = await calendar.calendarList.list({ minAccessRole: 'writer' });

        const existingCalendar = calendarList.data.items?.find(
          c => c.summary === 'Vlomis Planning'
        );

        if (existingCalendar?.id) {
          calendarId = existingCalendar.id;
          console.log(`[Sync] Found existing Vlomis Planning calendar: ${calendarId}`);
        } else {
          // Create new calendar
          console.log('[Sync] Creating new Vlomis Planning calendar...');
          const newCalendar = await calendar.calendars.insert({
            requestBody: {
              summary: 'Vlomis Planning',
              description: 'Automatische planning van Vlomis',
              timeZone: 'Europe/Brussels'
            }
          });

          if (newCalendar.data.id) {
            calendarId = newCalendar.data.id;
            console.log(`[Sync] Created new Vlomis calendar: ${calendarId}`);
          }
        }

        // CRITICAL: Save this ID to the user record IMMEDIATELY
        if (calendarId && calendarId !== 'primary') {
          console.log(`[Sync] Persisting calendar ID ${calendarId} to user ${userId}`);
          const { error: updateError } = await supabase
            .from('users')
            .update({ google_calendar_id: calendarId })
            .eq('id', userId);

          if (updateError) {
            console.error(`[Sync] FAILED to save calendar ID to DB: ${updateError.message}`);
          }
        }
      } catch (err) {
        console.error('[Sync] Error in calendar setup:', err);
        // Fallback to primary only as last resort, but log it clearly
        if (calendarId === 'primary') {
          console.warn('[Sync] FATAL: Could not prepare dedicated calendar, using primary.');
        }
      }
    }

    // 4. SMART CLEANUP: Instead of wiping, we fetch existing events and only delete what is no longer needed
    if (calendarId && calendarId !== 'primary') {
      try {
        console.log(`[Sync] Fetching existing events in calendar ${calendarId} for smart diffing...`);
        const eventsRes = await calendar.events.list({ calendarId, maxResults: 1000 });
        const existingEvents = eventsRes.data.items || [];

        // Generate a set of current event IDs that SHOULD exist
        const currentEventIds = new Set(events.map(entry => {
          const syncId = entry.vlomis_entry_id || `${entry.medewerker}-${entry.van}-${entry.registratiesoort}`;
          return crypto.createHash('sha256').update(syncId).digest('hex');
        }));

        const eventsToDelete = existingEvents.filter(ev => ev.id && !currentEventIds.has(ev.id));

        if (eventsToDelete.length > 0) {
          console.log(`[Sync] Found ${eventsToDelete.length} stale events to remove.`);
          for (const ev of eventsToDelete) {
            if (ev.id) {
              await calendar.events.delete({ calendarId, eventId: ev.id });
            }
          }
          console.log('[Sync] Smart cleanup complete.');
        } else {
          console.log('[Sync] No stale events found. Skipping cleanup.');
        }
      } catch (err: any) {
        console.warn(`[Sync] Smart cleanup failed/skipped: ${err.message}`);
      }
    }

    // Sort events so upcoming ones are processed first
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const threeMonthsFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const sortedEvents = [...events].sort((a, b) => {
      const dateA = new Date(a.van).getTime();
      const dateB = new Date(b.van).getTime();

      // If one is in the "priority window" and other isn't, prioritize it
      const inWindowA = dateA >= oneWeekAgo.getTime() && dateA <= threeMonthsFromNow.getTime();
      const inWindowB = dateB >= oneWeekAgo.getTime() && dateB <= threeMonthsFromNow.getTime();

      if (inWindowA && !inWindowB) return -1;
      if (!inWindowA && inWindowB) return 1;

      // Otherwise sort normally by date
      return dateA - dateB;
    });

    console.log(`[Sync] Starting prioritized sync for user ${userId}. Total potential events: ${events.length}. Calendar: ${calendarId}`);

    const BATCH_SIZE = 10;
    let processedCount = 0;
    const MAX_SYNC = limit;

    for (let i = 0; i < sortedEvents.length; i += BATCH_SIZE) {
      if (processedCount >= MAX_SYNC) break;

      const batch = sortedEvents.slice(i, Math.min(i + BATCH_SIZE, sortedEvents.length));

      for (const entry of batch) {
        if (processedCount >= MAX_SYNC) break;

        const type = entry.registratiesoort || '';
        // Skip Rust and Reserve entries as per user request
        if (type.includes('Rust') || type.includes('Reserve')) continue;

        const syncId = entry.vlomis_entry_id || `${entry.medewerker}-${entry.van}-${entry.registratiesoort}`;
        const eventId = crypto.createHash('sha256').update(syncId).digest('hex');

        // Environment-independent time formatting (always Brussels local)
        const formatTimeBrussels = (isoString: string) => {
          const dateObj = new Date(isoString);
          const m = dateObj.getUTCMonth();
          const d = dateObj.getUTCDate();
          const h = dateObj.getUTCHours();

          let offset = 1;
          if (m > 2 && m < 9) offset = 2;
          else if (m === 2) {
            const lastSun = d - dateObj.getUTCDay();
            if (lastSun > 25 || (lastSun === 25 && h >= 1)) offset = 2;
          } else if (m === 9) {
            const lastSun = d - dateObj.getUTCDay();
            if (lastSun < 25 || (lastSun === 25 && h < 1)) offset = 2;
          }

          const localHours = (h + offset) % 24;
          const localMins = dateObj.getUTCMinutes();
          return `${String(localHours).padStart(2, '0')}:${String(localMins).padStart(2, '0')}`;
        };

        const vesselOrFunction = entry.vaartuig || entry.functie || '';
        const timeRange = entry.van.includes('T') ? ` (${formatTimeBrussels(entry.van)} - ${formatTimeBrussels(entry.tot)})` : '';
        const summary = `${type}${vesselOrFunction ? ` - ${vesselOrFunction}` : ''}${timeRange}`;

        const description = `Vaartuig: ${entry.vaartuig}\nFunctie: ${entry.functie}\nAfdeling: ${entry.afdeling}`.trim();

        const localDate = entry.date;
        const start = { date: localDate };
        const dt = new Date(localDate);
        dt.setDate(dt.getDate() + 1);
        const end = { date: dt.toISOString().split('T')[0] };

        const eventResource = {
          summary,
          description,
          start,
          end,
          id: eventId,
          reminders: { useDefault: true },
          transparency: 'transparent'
        };

        try {
          await calendar.events.insert({
            calendarId,
            requestBody: eventResource,
          });
          processedCount++;
        } catch (e: any) {
          if (e.code === 409) {
            try {
              await calendar.events.update({
                calendarId,
                eventId: eventId,
                requestBody: eventResource,
              });
              processedCount++;
            } catch (upErr: any) {
              console.error(`[Sync] Update failed for ${eventId}:`, upErr.message);
            }
          } else {
            console.error(`[Sync] Insert failed for ${eventId}:`, e.message);
          }
        }

        // Small delay per event
        await new Promise(r => setTimeout(r, 50));
      }
      // Breather between batches
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`[Sync] Finished. Processed ${processedCount} relevant events.`);
  } catch (error: any) {
    console.error('[Sync] Fatal Error:', error);
    throw error;
  }
}
