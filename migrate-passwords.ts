import { supabase } from './lib/supabase'
import { encrypt } from './lib/encryption'

async function migratePasswords() {
    console.log('Starting password migration...')

    const { data: users, error } = await supabase
        .from('users')
        .select('id, vlomis_username, vlomis_password')

    if (error) {
        console.error('Error fetching users:', error)
        return
    }

    console.log(`Found ${users?.length || 0} users to check.`)

    for (const user of users || []) {
        if (!user.vlomis_password.includes(':')) {
            console.log(`Encrypting password for user: ${user.vlomis_username}`)
            const encrypted = encrypt(user.vlomis_password)

            const { error: updateError } = await supabase
                .from('users')
                .update({ vlomis_password: encrypted })
                .eq('id', user.id)

            if (updateError) {
                console.error(`Failed to update ${user.vlomis_username}:`, updateError)
            } else {
                console.log(`Successfully encrypted ${user.vlomis_username}`)
            }
        } else {
            console.log(`User ${user.vlomis_username} already has an encrypted password.`)
        }
    }

    console.log('Migration complete.')
}

migratePasswords()
