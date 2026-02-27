import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: users, error } = await supabase.from('users').select('id, display_name, vlomis_username, google_calendar_id, last_sync_at');
  if (error) console.error(error);
  console.table(users);
}
check();
