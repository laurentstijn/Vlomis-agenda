import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
        return NextResponse.json({ success: false, error: "Username required" }, { status: 400 });
    }

    console.log(`[Debug] Hard resetting user: ${username}`);

    const { supabase } = await import('@/lib/supabase');

    // 1. Find user (robust search)
    const { data: users, error: findError } = await supabase
        .from('users')
        .select('*')
        .ilike('vlomis_username', `%${username}%`);

    if (findError || !users || users.length === 0) {
        return NextResponse.json({
            success: false,
            error: "User not found (Find Error)",
            searchedFor: username,
            details: findError,
            countFound: users?.length || 0
        });
    }

    if (users.length > 1) {
        return NextResponse.json({
            success: false,
            error: "Multiple users found (be more specific)",
            found: users.map((u: any) => u.vlomis_username)
        });
    }

    const user = users[0];
    console.log(`[Debug] Found user ID: ${user.id}`);

    // 2. Delete planning entries
    const { error: delEntriesError, count: entCount } = await supabase
        .from('planning_entries')
        .delete({ count: 'exact' })
        .eq('user_id', user.id);

    console.log(`[Debug] Deleted ${entCount || 0} planning entries. Error:`, delEntriesError);

    // 3. Delete user rows
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
