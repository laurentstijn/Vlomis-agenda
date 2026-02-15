import { NextResponse } from "next/server";
import { hardResetUser } from "@/lib/user-db";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
        return NextResponse.json({ success: false, error: "Username required" }, { status: 400 });
    }

    console.log(`[Debug] Hard resetting user: ${username}`);

    const { supabase } = await import('@/lib/supabase');

    // 1. Find user
    const { data: user, error: findError } = await supabase
        .from('users')
        .select('*')
        .eq('vlomis_username', username)
        .single();

    if (findError) {
        return NextResponse.json({ success: false, error: "User not found (Find Error)", details: findError });
    }

    console.log(`[Debug] Found user ID: ${user.id}`);

    // 2. Delete planning entries
    const { error: delEntriesError, count: entCount } = await supabase
        .from('planning_entries')
        .delete({ count: 'exact' })
        .eq('user_id', user.id);

    console.log(`[Debug] Deleted ${entCount || 0} planning entries. Error:`, delEntriesError);

    // 3. Delete user
    const { error: delUserError, count: userCount } = await supabase
        .from('users')
        .delete({ count: 'exact' })
        .eq('id', user.id || '');

    console.log(`[Debug] Deleted ${userCount || 0} user rows. Error:`, delUserError);

    if (delUserError) {
        return NextResponse.json({ success: false, error: "User delete failed (Delete Error)", details: delUserError });
    }

    return NextResponse.json({
        success: true,
        message: `User ${username} reset successfully.`,
        entriesDeleted: entCount || 0,
        usersDeleted: userCount || 0
    });
}
