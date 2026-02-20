import { google } from 'googleapis';
import { supabaseAdmin } from './supabase-admin';
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

  const { error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', userId);

  if (error) throw error;
}

export async function getGoogleClientForUser(userId: string) {
  // Get tokens from DB
  const { data: user, error } = await supabaseAdmin
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
    console.log(`[syncEventsToCalendar] Starting smart sync for user ${userId} with ${events.length} potential events`);

    const auth = await getGoogleClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    // 1. Get or create dedicated calendar
    let calendarId = 'primary';
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('google_calendar_id')
      .eq('id', userId)
      .single();

    if (userData?.google_calendar_id && userData.google_calendar_id !== 'primary') {
      try {
        await calendar.calendars.get({ calendarId: userData.google_calendar_id });
        calendarId = userData.google_calendar_id;
      } catch (err: any) {
        if (err.code === 404) {
          console.log('[syncEventsToCalendar] Calendar not found, resetting to primary logic.');
          calendarId = 'primary';
        } else {
          throw err;
        }
      }
    }

    if (calendarId === 'primary' || !calendarId) {
      // Logic to find/create 'Vlomis Planning' (Simplified for brevity, assuming established)
      try {
        const calendarList = await calendar.calendarList.list({ minAccessRole: 'writer' });
        const existingCalendar = calendarList.data.items?.find(c => c.summary === 'Vlomis Planning');
        if (existingCalendar?.id) {
          calendarId = existingCalendar.id;
        } else {
          const newCalendar = await calendar.calendars.insert({
            requestBody: { summary: 'Vlomis Planning', timeZone: 'Europe/Brussels' }
          });
          if (newCalendar.data.id) calendarId = newCalendar.data.id;
        }
        if (calendarId && calendarId !== 'primary') {
          await supabaseAdmin.from('users').update({ google_calendar_id: calendarId }).eq('id', userId);
        }
      } catch (e) {
        console.error('Error finding/creating calendar', e);
      }
    }

    // 2. FETCH ALL EXISTING EVENTS (Up to 2500)
    console.log(`[Sync] Fetching existing events from ${calendarId}...`);
    const eventsRes = await calendar.events.list({
      calendarId,
      maxResults: 2500,
      showDeleted: false,
      singleEvents: true
    });
    const existingEvents = eventsRes.data.items || [];
    const hexRegex = /^[0-9a-f]{64}$/;

    // Map of ID -> Event
    const existingMap = new Map<string, any>();

    // cleanup old reports immediately
    const oldReports = existingEvents.filter(ev =>
      ev.summary && (ev.summary.includes('RAPPORT') || ev.summary.includes('🔔'))
    );

    if (oldReports.length > 0) {
      console.log(`[Sync] Found ${oldReports.length} old report(s). Cleaning up...`);
      for (const report of oldReports) {
        if (report.id) {
          try {
            await calendar.events.delete({ calendarId, eventId: report.id });
          } catch (e) {
            console.error(`[Sync] Failed to delete old report ${report.id}`);
          }
        }
      }
    }

    existingEvents.forEach(ev => {
      if (ev.id && hexRegex.test(ev.id)) {
        existingMap.set(ev.id, ev);
      }
    });

    // 3. PREPARE NEW EVENTS & TRACK CHANGES
    const changes = {
      added: [] as string[],
      modified: [] as string[],
      removed: [] as string[],
      totalProcessed: 0
    };

    const currentEventIds = new Set<string>();

    // Sort events (logic preserved)
    const now = new Date();
    const sortedEvents = [...events].sort((a, b) => new Date(a.van).getTime() - new Date(b.van).getTime());

    // Environment-independent time
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

    for (const entry of sortedEvents) {
      const type = entry.registratiesoort || '';
      if (type.includes('Rust') || type.includes('Reserve')) continue;

      const syncId = entry.vlomis_entry_id || `${entry.medewerker}-${entry.van}-${entry.registratiesoort}`;
      const eventId = crypto.createHash('sha256').update(syncId).digest('hex');
      currentEventIds.add(eventId);

      const vesselOrFunction = entry.vaartuig || entry.functie || '';
      const timeRange = entry.van.includes('T') ? ` (${formatTimeBrussels(entry.van)} - ${formatTimeBrussels(entry.tot)})` : '';
      const summary = vesselOrFunction
        ? `${vesselOrFunction} - ${type}${timeRange}`
        : `${type}${timeRange}`;
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
        reminders: { useDefault: false, overrides: [] }, // No reminders
        transparency: 'transparent'
      };

      const existing = existingMap.get(eventId);

      if (!existing) {
        await calendar.events.insert({ calendarId, requestBody: eventResource });
        changes.added.push(`${localDate}: ${summary}`);
      } else {
        const isDifferent =
          existing.summary !== summary ||
          existing.description !== description ||
          existing.start?.date !== start.date;

        if (isDifferent) {
          await calendar.events.update({ calendarId, eventId, requestBody: eventResource });
          changes.modified.push(`${localDate}: ${summary}`);
        }
      }
      changes.totalProcessed++;
      await new Promise(r => setTimeout(r, 50));
    }

    // 4. SMART CLEANUP (DELETE)
    for (const [id, ev] of existingMap) {
      if (!currentEventIds.has(id)) {
        await calendar.events.delete({ calendarId, eventId: id });
        changes.removed.push(`${ev.start?.date || '?'}: ${ev.summary}`);
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // 5. NOTIFICATION REPORT
    const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.removed.length > 0;

    if (hasChanges) {
      console.log(`[Sync] Changes detected (Add: ${changes.added.length}, Mod: ${changes.modified.length}, Del: ${changes.removed.length}). Creating report event...`);
      const title = `🔔 RAPPORT: +${changes.added.length} ~${changes.modified.length} -${changes.removed.length}`;

      let desc = "Wijzigingen in je rooster:\n\n";
      if (changes.added.length) desc += "NIEUW:\n" + changes.added.join("\n") + "\n\n";
      if (changes.modified.length) desc += "GEWIJZIGD:\n" + changes.modified.join("\n") + "\n\n";
      if (changes.removed.length) desc += "VERWIJDERD:\n" + changes.removed.join("\n");

      // Schedule the event 1 hour in the future to ensure Google Calendar's notification engine
      // has enough time to process and dispatch the push notifications.
      const nowTime = new Date();
      const startTime = new Date(nowTime.getTime() + 60 * 60000); // Now + 1 uur
      const endTime = new Date(startTime.getTime() + 15 * 60000); // +15 mins duration

      try {
        const reportRes = await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: title,
            description: desc,
            start: { dateTime: startTime.toISOString() },
            end: { dateTime: endTime.toISOString() },
            reminders: {
              useDefault: false,
              overrides: [
                { method: 'popup', minutes: 59 }, // Triggers in ~1 minute
                { method: 'popup', minutes: 45 }  // Triggers in ~15 minutes
              ]
            },
            colorId: '11' // Red
          }
        });
        console.log(`[Sync] Report event created via API. ID: ${reportRes.data.id}`);
      } catch (err) {
        console.error('[Sync] FAILED to create report event:', err);
      }
    } else {
      console.log('[Sync] No changes detected, skipping report event.');
    }

    console.log(`[Sync] Finished. Added: ${changes.added.length}, Mod: ${changes.modified.length}, Del: ${changes.removed.length}`);

  } catch (error: any) {
    console.error('[Sync] Fatal Error:', error);
    throw error;
  }
}
