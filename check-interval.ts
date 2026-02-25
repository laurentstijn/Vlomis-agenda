import { supabaseAdmin } from "@/lib/supabase-admin";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.production.local" });
dotenv.config({ path: ".env.local", override: true });

async function check() {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('vlomis_username, last_sync_at, sync_interval_minutes');
  console.log(users);
}
check();
