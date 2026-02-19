import { supabase, PlanningEntry } from './supabase'

/**
 * Save scraped planning entries to Supabase
 * Uses upsert to update existing entries or insert new ones
 */
export async function savePlanningEntries(entries: any[], userId?: string, client = supabase): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
        if (!entries || !Array.isArray(entries)) {
            return { success: false, error: 'Invalid entries data' };
        }

        // Helper to convert DD/MM/YYYY HH:MM to YYYY-MM-DD (Robust)
        const convertToISODate = (dateStr: string): string => {
            if (!dateStr) return new Date().toISOString().split('T')[0];

            // If already ISO (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
                return dateStr.substring(0, 10);
            }

            // Handle DD/MM/YYYY or DD/MM/YYYY HH:MM
            const match = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
            if (match) {
                const [_, day, month, year] = match;
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }

            return dateStr; // Fallback
        };

        // Helper to convert to UTC ISO timestamp with Brussels offset awareness (Environmental-independent)
        const convertToISOTimestamp = (dateStr: string): string => {
            if (!dateStr) return new Date().toISOString();
            if (dateStr.includes('T')) return dateStr;

            try {
                const [datePart, timePart = '00:00'] = dateStr.trim().split(/\s+/);
                const bits = datePart.split('/');
                if (bits.length !== 3) return dateStr;

                const [day, month, year] = bits.map(n => parseInt(n));
                const [hours, minutes] = timePart.split(':').map(n => parseInt(n));

                // UTC date object as a base
                const dateObj = new Date(Date.UTC(year, month - 1, day, hours, minutes));

                // Manual Brussels Offset Calculation (CET = UTC+1, CEST = UTC+2)
                // Brussels follows EU DST rules: last Sunday of March to last Sunday of October
                let offset = 1; // Default to CET

                const m = month - 1; // 0-indexed
                if (m > 2 && m < 9) {
                    offset = 2; // April to September is always CEST
                } else if (m === 2) { // March
                    // Calculate if it's past the last Sunday of March (starts at 1:00 UTC)
                    const lastSunday = day - dateObj.getUTCDay();
                    if (lastSunday > 25 || (lastSunday === 25 && hours >= 1)) offset = 2;
                } else if (m === 9) { // October
                    // Calculate if it's before the last Sunday of October (ends at 1:00 UTC)
                    const lastSunday = day - dateObj.getUTCDay();
                    if (lastSunday < 25 || (lastSunday === 25 && hours < 1)) offset = 2;
                }

                return new Date(dateObj.getTime() - (offset * 60 * 60 * 1000)).toISOString();
            } catch (e) {
                console.error('[Timezone] Error:', e);
                return dateStr;
            }
        };

        // Transform entries to match database schema
        const dbEntries = entries.map(entry => {
            const ISOdate = convertToISODate(entry.date);
            const vanISO = convertToISOTimestamp(entry.van);
            const totISO = convertToISOTimestamp(entry.tot);

            // Stable ID logic to match scraper
            const timeStr = entry.van && entry.van.includes(' ') ? entry.van.split(' ')[1] :
                (entry.van && entry.van.includes('T') ? entry.van.split('T')[1].substring(0, 5) : '00:00');

            return {
                vlomis_entry_id: entry.vlomis_entry_id || `${entry.medewerker}-${ISOdate}-${entry.registratiesoort}-${timeStr.padStart(5, '0')}`,
                date: ISOdate,
                van: vanISO,
                tot: totISO,
                registratiesoort: entry.registratiesoort,
                medewerker: entry.medewerker,
                functie: entry.functie,
                afdeling: entry.afdeling,
                vaartuig: entry.vaartuig,
                user_id: userId,
                last_scraped_at: new Date().toISOString(),
            };
        });

        // Cleanup Step: Remove "base" entries if an "(Aangevraagd)" version now exists.
        const pendingEntries = entries.filter(e => e.registratiesoort && e.registratiesoort.includes('(Aangevraagd)'));

        if (pendingEntries.length > 0) {
            // Batch delete base entries to avoid rate limits
            // We group by medewerker to minimize calls, or just use a single 'in' query if possible
            const deletePromises = pendingEntries.map(entry => {
                const baseType = entry.registratiesoort.replace(' (Aangevraagd)', '');
                const vanISO = convertToISOTimestamp(entry.van);

                return client
                    .from('planning_entries')
                    .delete()
                    .match({
                        medewerker: entry.medewerker,
                        van: vanISO,
                        registratiesoort: baseType
                    });
            });

            // Using Promise.all is okay, but we could also throttle if needed.
            // For now, moving to a single request per pending entry is better than what we had if it was async.
            // Actually, let's just make sure we don't overwhelm.
            await Promise.all(deletePromises);
        }

        // Upsert entries
        const { error, data } = await client
            .from('planning_entries')
            .upsert(dbEntries, {
                onConflict: 'medewerker,van,tot,registratiesoort',
                ignoreDuplicates: false,
            })
            .select();

        if (error) {
            console.error('[Sync] DB error:', error);
            return { success: false, error: error.message };
        }

        return { success: true, data: data || [] };
    } catch (err) {
        console.error('[Sync] Save error:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export async function clearOldEntries(medewerker: string, userId?: string) {
    let query = supabase.from('planning_entries').delete().ilike('medewerker', medewerker);
    if (userId) query = query.eq('user_id', userId);
    await query;
}

export async function getPlanningEntries(medewerker?: string, from?: string, to?: string, userId?: string, client = supabase): Promise<{ success: boolean; data: PlanningEntry[]; error?: string }> {
    try {
        let query = client
            .from('planning_entries')
            .select('*')
            .order('van', { ascending: true });

        if (medewerker) {
            query = query.ilike('medewerker', medewerker);
        }

        if (userId) {
            query = query.eq('user_id', userId);
        }

        const { data, error } = await query;
        if (error) {
            console.error('Error fetching planning:', error);
            return { success: false, data: [], error: error.message };
        }
        return { success: true, data: data || [] };
    } catch (err) {
        return { success: false, data: [], error: String(err) };
    }
}

/**
 * Remove entries that were not just updated (stale)
 * - Only targets entries from today onwards to preserve historical data
 * - ALSO implements a 1-year retention policy (deletes entries older than 365 days)
 */
export async function cleanupOldEntries(medewerker: string, userId: string, client = supabase) {
    if (!userId) return;

    // 1. Retention Policy: Remove entries older than 365 days
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];

    await client
        .from('planning_entries')
        .delete()
        .eq('user_id', userId)
        .ilike('medewerker', medewerker)
        .lt('date', oneYearAgoStr);

    // 2. Stale Data Cleanup: Remove today/future entries that were missed in the last scrape
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase
        .from('planning_entries')
        .delete()
        .eq('user_id', userId)
        .ilike('medewerker', medewerker)
        .gte('date', today) // ONLY target today or future entries
        .lt('last_scraped_at', tenMinsAgo);

    if (error) console.error('[Cleanup] Error:', error);
}

export async function getFirstDataDate(medewerker: string, userId?: string, client = supabase): Promise<string | null> {
    let query = client
        .from('planning_entries')
        .select('date')
        .ilike('medewerker', medewerker)
        .order('date', { ascending: true })
        .limit(1);

    if (userId) query = query.eq('user_id', userId);

    const { data } = await query;
    return data?.[0]?.date || null;
}
