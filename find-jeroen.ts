import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

async function findJeroen() {
  const { data, error } = await supabase
    .from('users')
    .select('vlomis_username, display_name, google_access_token, google_calendar_id')
    .or('vlomis_username.ilike.%jeroen%,display_name.ilike.%jeroen%');

  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}

findJeroen();
