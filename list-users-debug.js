const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read from .env.production
const envFile = fs.readFileSync(path.join(__dirname, '.env.production'), 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length === 2) {
        env[parts[0].trim()] = parts[1].trim().replace(/^\"|\"$/g, '');
    }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function listUsers() {
    console.log('--- Current Users in DB ---');
    const { data, error } = await supabase.from('users').select('id, vlomis_username, display_name');
    if (error) {
        console.error('Error:', error);
    } else {
        console.log(data);
    }
    console.log('---------------------------');
}

listUsers();
