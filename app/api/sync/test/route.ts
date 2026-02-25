import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPlanningEntries } from "@/lib/planning-db";
import { syncEventsToCalendar } from "@/lib/google-calendar";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');

  if (!username) return NextResponse.json({ error: "Missing username" }, { status: 400 });

  const { data: user } = await supabaseAdmin.from('users').select('*').eq('vlomis_username', username).single();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const dbResult = await getPlanningEntries(username, undefined, undefined, user.id, supabaseAdmin);
  const data = dbResult.success ? dbResult.data : [];

  if (data.length === 0) return NextResponse.json({ error: "No data in DB" }, { status: 400 });

  try {
    await syncEventsToCalendar(user.id, data, 500);
    return NextResponse.json({ success: true, message: "Sync complete", count: data.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
