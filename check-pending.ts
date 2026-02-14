import { supabase } from './lib/supabase'

async function checkPending() {
    const { data, error } = await supabase
        .from('planning_entries')
        .select('registratiesoort, date')
        .ilike('registratiesoort', '%Aangevraagd%')
        .limit(5);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Found pending entries:', data);

        // Also check total count of entries to see if scrape happened recently
        const { count } = await supabase
            .from('planning_entries')
            .select('*', { count: 'exact', head: true });
        console.log('Total entries:', count);
    }
}

checkPending()
