import { supabase, PlanningEntry } from './supabase'

/**
 * Save scraped planning entries to Supabase
 * Uses upsert to update existing entries or insert new ones
 */
export async function savePlanningEntries(entries: any[], userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Helper to convert DD/MM/YYYY HH:MM to YYYY-MM-DD
        const convertToISODate = (dateStr: string): string => {
            const [datePart] = dateStr.split(/\s+/);
            const [day, month, year] = datePart.split('/');
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        };

        // Helper to convert DD/MM/YYYY HH:MM to ISO timestamp
        const convertToISOTimestamp = (dateStr: string): string => {
            const [datePart, timePart = '00:00'] = dateStr.split(/\s+/);
            const [day, month, year] = datePart.split('/');
            const [hours, minutes] = timePart.split(':');
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00Z`;
        };

        // Transform entries to match database schema
        const dbEntries = entries.map(entry => ({
            vlomis_entry_id: `${entry.medewerker}-${entry.van}-${entry.registratiesoort}`,
            date: convertToISODate(entry.date),
            van: convertToISOTimestamp(entry.van),
            tot: convertToISOTimestamp(entry.tot),
            registratiesoort: entry.registratiesoort,
            medewerker: entry.medewerker,
            functie: entry.functie,
            afdeling: entry.afdeling,
            vaartuig: entry.vaartuig,
            user_id: userId,
            last_scraped_at: new Date().toISOString(),
        }))

        // Cleanup Step: Remove "base" entries if an "(Aangevraagd)" version now exists.
        // This prevents duplicates like "Verlof" AND "Verlof (Aangevraagd)" co-existing.
        const pendingEntries = entries.filter(e => e.registratiesoort && e.registratiesoort.includes('(Aangevraagd)'));

        if (pendingEntries.length > 0) {
            console.log(`Found ${pendingEntries.length} pending entries. Cleaning up potential duplicates...`);
            const deletePromises = pendingEntries.map(async (entry) => {
                const baseType = entry.registratiesoort.replace(' (Aangevraagd)', '');
                const vanISO = convertToISOTimestamp(entry.van);

                // Delete the "old" version without (Aangevraagd)
                await supabase
                    .from('planning_entries')
                    .delete()
                    .match({
                        medewerker: entry.medewerker,
                        van: vanISO,
                        registratiesoort: baseType
                    });
            });

            await Promise.all(deletePromises);
        }

        // Upsert entries (insert or update if exists)
        const { error } = await supabase
            .from('planning_entries')
            .upsert(dbEntries, {
                onConflict: 'medewerker,van,tot,registratiesoort',
                ignoreDuplicates: false,
            })

        if (error) {
            console.error('Supabase upsert error:', error)
            return { success: false, error: error.message }
        }

        return { success: true }
    } catch (error: any) {
        console.error('Save planning entries error:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Get all planning entries from Supabase for a specific employee
 * Optionally filter by date range
 */
export async function getPlanningEntries(
    medewerker: string,
    fromDate?: string,
    toDate?: string,
    userId?: string
): Promise<{ success: boolean; data: PlanningEntry[]; error?: string }> {
    try {
        let query = supabase
            .from('planning_entries')
            .select('*')
            .order('van', { ascending: true })

        if (userId) {
            query = query.eq('user_id', userId)
        } else {
            query = query.eq('medewerker', medewerker)
        }

        if (fromDate) {
            query = query.gte('date', fromDate)
        }

        if (toDate) {
            query = query.lte('date', toDate)
        }

        const { data, error } = await query

        if (error) {
            console.error('Supabase query error:', error)
            return { success: false, data: [], error: error.message }
        }

        // Transform database entries back to API format
        const entries: PlanningEntry[] = (data || []).map(entry => ({
            id: entry.id,
            date: entry.date,
            van: entry.van,
            tot: entry.tot,
            registratiesoort: entry.registratiesoort,
            medewerker: entry.medewerker,
            functie: entry.functie,
            afdeling: entry.afdeling,
            vaartuig: entry.vaartuig,
        }))

        return { success: true, data: entries }
    } catch (error: any) {
        console.error('Get planning entries error:', error)
        return { success: false, data: [], error: error.message }
    }
}

/**
 * Get the earliest date we have data for (first login date)
 */
export async function getFirstDataDate(medewerker: string, userId?: string): Promise<string | null> {
    try {
        let query = supabase
            .from('planning_entries')
            .select('date')
            .order('date', { ascending: true })

        if (userId) {
            query = query.eq('user_id', userId)
        } else {
            query = query.eq('medewerker', medewerker)
        }

        const { data, error } = await query.limit(1)

        if (error || !data || data.length === 0) {
            return null
        }

        return data[0].date
    } catch (error) {
        console.error('Get first data date error:', error)
        return null
    }
}

/**
 * Delete planning entries older than 1 year to keep database size manageable
 * This helps stay within Supabase free tier limits
 */
export async function cleanupOldEntries(medewerker: string, userId?: string): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
    try {
        // Calculate date 1 year ago
        const oneYearAgo = new Date()
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
        const cutoffDate = oneYearAgo.toISOString().split('T')[0] // YYYY-MM-DD format

        console.log(`Cleaning up entries older than ${cutoffDate} for ${medewerker}${userId ? ` (User: ${userId})` : ''}`)

        let query = supabase
            .from('planning_entries')
            .delete({ count: 'exact' })
            .lt('date', cutoffDate)

        if (userId) {
            query = query.eq('user_id', userId)
        } else {
            query = query.eq('medewerker', medewerker)
        }

        const { error, count } = await query

        if (error) {
            console.error('Cleanup error:', error)
            return { success: false, error: error.message }
        }

        console.log(`Deleted ${count || 0} old entries`)
        return { success: true, deletedCount: count || 0 }
    } catch (error: any) {
        console.error('Cleanup old entries error:', error)
        return { success: false, error: error.message }
    }
}
