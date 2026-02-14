import { supabase } from './lib/supabase'

async function forceClearId() {
    const { data: user } = await supabase.from('users').select('id').single()
    if (user) {
        console.log(`Clearing ID for user ${user.id}`)
        const { error } = await supabase
            .from('users')
            .update({ google_calendar_id: null })
            .eq('id', user.id)

        if (error) console.error('Error:', error)
        else console.log('Successfully cleared google_calendar_id')
    }
}

forceClearId()
