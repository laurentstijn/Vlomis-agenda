import { supabase } from './lib/supabase'

async function checkEncryption() {
    console.log('Checking user passwords in database...')

    const { data: users, error } = await supabase
        .from('users')
        .select('vlomis_username, vlomis_password')
        .limit(5)

    if (error) {
        console.error('Error fetching users:', error)
        return
    }

    console.log(`Found ${users?.length || 0} users.`)
    users?.forEach(user => {
        const isEncrypted = user.vlomis_password.includes(':');
        console.log(`User: ${user.vlomis_username} | Password stored as encrypted: ${isEncrypted}`);
        if (isEncrypted) {
            console.log(`  Example of stored value: ${user.vlomis_password.substring(0, 20)}...`);
        } else {
            console.log('  WARNING: Password is plain text!');
        }
    })
}

checkEncryption()
