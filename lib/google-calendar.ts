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

export async function syncEventsToCalendar(userId: string, events: any[], limit: number = 500, forceReport: boolean = false, includeHistory: boolean = false, referteData?: any) {
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

    // 2. FETCH ALL EXISTING EVENTS (With pagination for robustness)
    console.log(`[Sync] Fetching existing events from ${calendarId}...`);
    const existingEvents: any[] = [];
    let pageToken: string | undefined = undefined;

    try {
      do {
        const res = await calendar.events.list({
          calendarId,
          maxResults: 2500,
          showDeleted: true, // Crucial: see events in the trash
          singleEvents: true,
          pageToken: pageToken
        });
        if (res.data.items) existingEvents.push(...res.data.items);
        pageToken = (res.data as any).nextPageToken;
      } while (pageToken);
    } catch (listErr) {
      console.error("[Sync] Failed to list events:", listErr);
      // If listing fails but we have data, we might want to proceed or stop. 
      // For now, let's stop to avoid duplicates.
      throw listErr;
    }
    const hexRegex = /^[0-9a-f]{64}$/;

    // Map of ID -> Event
    const existingMap = new Map<string, any>();

    // cleanup old reports immediately
    const oldReports = existingEvents.filter(ev =>
      ev.summary && (ev.summary.includes('RAPPORT') || ev.summary.includes('🔔') || ev.summary.includes('STATUS') || ev.summary.includes('📅'))
    );

    if (oldReports.length > 0) {
      console.log(`[Sync] Found ${oldReports.length} old report(s). Cleaning up...`);
      for (const report of oldReports) {
        if (report.id) {
          try {
            await calendar.events.delete({ calendarId, eventId: report.id });
            await new Promise(r => setTimeout(r, 250));
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

    // 1. FILTER & SORT
    // First remove items we definitely don't want in Google Calendar
    // Also exclude events from before the current month - Vlomis only scrapes from
    // the 1st of the current month, so we should not touch past events in the calendar.
    // includeHistory=true bypasses this for manual restore operations.
    const todayObj = new Date();
    const syncStartDate = new Date(todayObj.getFullYear(), todayObj.getMonth(), 1).toISOString().split('T')[0];
    let filteredEvents = events.filter(entry => {
      const type = entry.registratiesoort || '';
      if (type.includes('Rust') || type.includes('Reserve') || type === 'REFERTE_STAND') return false;
      // Only sync events from the current month onwards to avoid false "Hersteld" notifications
      if (!includeHistory && entry.date < syncStartDate) return false;
      return true;
    });

    // Sort by date
    filteredEvents.sort((a, b) => new Date(a.van).getTime() - new Date(b.van).getTime());

    // 2. APPLY LIMIT (after filtering)
    // If limit is provided, only take the first N relevant entries
    const actualLimit = limit || 500;
    if (filteredEvents.length > actualLimit) {
      console.log(`[Sync] Limiting ${filteredEvents.length} relevant events to ${actualLimit}.`);
      filteredEvents = filteredEvents.slice(0, actualLimit);
    }

    const currentEventIds = new Set<string>();

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

    for (const entry of filteredEvents) {
      const type = entry.registratiesoort || '';

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

      // Events ~11+ months (330+ days) in the future belong to the sliding 1-year horizon
      // rolling forward daily. They are synced to the calendar, but omitted from notification reports.
      const eventDateObj = new Date(localDate);
      const diffDays = Math.round((eventDateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
      const isRollingHorizon = diffDays >= 330;

      const existing = existingMap.get(eventId);

      if (!existing) {
        try {
          await calendar.events.insert({ calendarId, requestBody: eventResource });
          if (!isRollingHorizon) {
            changes.added.push(`${localDate}: ${summary}`);
          } else {
            console.log(`[Sync] Omitting rolling 1-year horizon event from report: ${localDate}: ${summary}`);
          }
        } catch (err: any) {
          // Handle "Identifier already exists" (409 Conflict)
          if (err.code === 409) {
            console.warn(`[Sync] 409 Conflict for ${eventId}. Trying update instead.`);
            await calendar.events.update({ calendarId, eventId, requestBody: eventResource });
            if (!isRollingHorizon) {
              changes.modified.push(`${localDate}: ${summary} (Auto-fix 409)`);
            }
          } else {
            throw err;
          }
        }
      } else {
        const isCancelled = existing.status === 'cancelled';
        const isDifferent =
          isCancelled ||
          existing.summary !== summary ||
          existing.description !== description ||
          existing.start?.date !== start.date;

        if (isDifferent) {
          // If it was in the trash, restore it while updating
          const body = isCancelled
            ? { ...eventResource, status: 'confirmed' }
            : eventResource;

          await calendar.events.update({ calendarId, eventId, requestBody: body });
          if (!isRollingHorizon) {
            changes.modified.push(`${localDate}: ${summary}${isCancelled ? ' (Hersteld)' : ''}`);
          }
        }
      }
      changes.totalProcessed++;
      // Increased delay to 250ms for performance and avoiding rate limits
      await new Promise(r => setTimeout(r, 250));
    }

    // 4. SMART CLEANUP (DELETE)
    // We only clean up events starting from the first day of the current month
    // because Vlomis scraping only fetches from the 1st of the current month.
    // Older events are preserved in the calendar to maintain history.
    const currentMonthStart = new Date(todayObj.getFullYear(), todayObj.getMonth(), 1).toISOString();
    const currentMonthStartLocal = currentMonthStart.split('T')[0];

    for (const [id, ev] of existingMap) {
      // Don't "re-delete" already cancelled events
      if (!currentEventIds.has(id) && ev.status !== 'cancelled') {
        // Extract the event start date
        const eventDateStr = ev.start?.date || ev.start?.dateTime;
        const isFromCurrentMonthOnwards = eventDateStr && eventDateStr >= currentMonthStartLocal;

        if (isFromCurrentMonthOnwards) {
          await calendar.events.delete({ calendarId, eventId: id });
          const eventDateObj = new Date(eventDateStr);
          const diffDays = Math.round((eventDateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
          const isRollingHorizon = diffDays >= 330;
          if (!isRollingHorizon) {
            changes.removed.push(`${ev.start?.date || '?'}: ${ev.summary}`);
          }
          // Increased delay to 250ms for performance and avoiding rate limits
          await new Promise(r => setTimeout(r, 250));
        } else {
          // It's a past event, do not delete it!
          console.log(`[Sync] Skipping deletion of past event: ${ev.summary} (${eventDateStr})`);
        }
      }
    }

    // 5. NOTIFICATION REPORT
    const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.removed.length > 0;

    // --- Referte periode berekening ---
    let referteLine = '';
    if (referteData && referteData.gepresteerd) {
      referteLine = `\n\n📊 REFERTE PERIODE (${referteData.label || 'Vlomis'}):\n` +
        `   In rooster / Gepresteerd: ${referteData.gepresteerd} uur\n` +
        (referteData.opgespaard && referteData.opgespaard !== '0:00' ? `   Opgespaard overwerk:      ${referteData.opgespaard} uur\n` : '') +
        `   Saldo recup:             ${referteData.saldoRecup || '0:00'} uur`;
    } else {
      const REFERTE_PERIODES = [
        { months: [11, 0, 1, 2], label: 'Dec–Mrt' },
        { months: [3, 4, 5, 6],  label: 'Apr–Jul' },
        { months: [7, 8, 9, 10], label: 'Aug–Nov' },
      ];
      const TELLENDE_TYPES = ['Dagdienst', 'Dagdienst kantooruren', 'Nachtdienst', 'Extra Opdracht', 'Vorming (dienstvrijstelling)', 'Geneeskundig onderzoek'];
      const nowForPeriode = new Date();
      const nowMonth = nowForPeriode.getMonth();
      const nowYear = nowForPeriode.getFullYear();
      const currentPeriode = REFERTE_PERIODES.find(p => p.months.includes(nowMonth)) || REFERTE_PERIODES[2];
      const periodeMonths = currentPeriode.months.map(m => {
        let year = nowYear;
        if (m === 11 && (nowMonth === 0 || nowMonth === 1 || nowMonth === 2)) year = nowYear - 1;
        return { month: m, year };
      });

      let totalWorkedMinutes = 0;
      for (const entry of events) {
        const type = entry.registratiesoort || '';
        if (!TELLENDE_TYPES.some(t => type.startsWith(t) || type.includes(t))) continue;
        const entryDate = new Date(entry.date);
        const em = entryDate.getMonth();
        const ey = entryDate.getFullYear();
        if (!periodeMonths.some(pm => pm.month === em && pm.year === ey)) continue;
        const vanDate = new Date(entry.van);
        const totDate = new Date(entry.tot);
        const durationMin = Math.round((totDate.getTime() - vanDate.getTime()) / 60000);
        if (durationMin > 0) totalWorkedMinutes += durationMin;
      }

      const fmtMin = (min: number) => {
        const h = Math.floor(Math.abs(min) / 60);
        const m = Math.abs(min) % 60;
        return `${min < 0 ? '-' : ''}${h}:${String(m).padStart(2, '0')}`;
      };
      referteLine = `\n\n📊 REFERTE PERIODE (${currentPeriode.label}):\n` +
        `   In rooster / Gepresteerd: ${fmtMin(totalWorkedMinutes)} uur`;
    }
    // --- Einde referte periode ---

    if (hasChanges || forceReport) {
      console.log(`[Sync] ${hasChanges ? 'Changes detected' : 'Forced report requested'}. Creating report event...`);

      let title = "";
      let desc = "";

      if (hasChanges) {
        title = `🔔 RAPPORT: +${changes.added.length} ~${changes.modified.length} -${changes.removed.length}`;
        desc = "Wijzigingen in je rooster:\n\n";
        if (changes.added.length) desc += "NIEUW:\n" + changes.added.join("\n") + "\n\n";
        if (changes.modified.length) desc += "GEWIJZIGD:\n" + changes.modified.join("\n") + "\n\n";
        if (changes.removed.length) desc += "VERWIJDERD:\n" + changes.removed.join("\n");
      } else {
        title = `📅 STATUS: Geen wijzigingen`;
        desc = "Er zijn momenteel geen nieuwe wijzigingen in je Vlomis planning.\n\nOverzicht van je eerstvolgende opdrachten:\n";

        // Add a small summary of next 3 upcoming events for context
        const upcoming = filteredEvents
          .filter(e => new Date(e.van).getTime() > Date.now())
          .slice(0, 3);

        if (upcoming.length > 0) {
          upcoming.forEach(e => {
            const timeRange = e.van.includes('T') ? ` (${formatTimeBrussels(e.van)} - ${formatTimeBrussels(e.tot)})` : '';
            desc += `- ${e.date}: ${e.vaartuig || e.functie || e.registratiesoort}${timeRange}\n`;
          });
        } else {
          desc += "- Geen geplande opdrachten gevonden in de nabije toekomst.";
        }
      }

      // Voeg referte periode toe aan elke melding
      desc += referteLine;

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

    // If the Google grant is invalid/revoked, clear it from the DB to prevent crashes
    if (error?.message === 'invalid_grant' || error?.response?.data?.error === 'invalid_grant' || error?.message?.includes('invalid_grant')) {
      console.warn(`[Google] Invalid grant for user ${userId}. Revoking tokens in DB.`);
      try {
        await supabaseAdmin
          .from('users')
          .update({
            google_access_token: null,
            google_refresh_token: null,
            google_token_expiry: null,
            google_calendar_id: null
          })
          .eq('id', userId);
        console.log(`[Google] Successfully revoked tokens for ${userId}`);
      } catch (dbErr) {
        console.error(`[Google] Failed to revoke tokens for ${userId}:`, dbErr);
      }
    }

    throw error;
  }
}
