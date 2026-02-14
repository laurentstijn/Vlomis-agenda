import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        // Remove Google tokens from the user record
        const { error } = await supabase
            .from('users')
            .update({
                google_access_token: null,
                google_refresh_token: null,
                google_token_expiry: null,
                google_calendar_id: 'primary' // Reset to default
            })
            .eq('id', userId);

        if (error) {
            console.error("Error disconnecting Google Calendar:", error);
            return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error("Disconnect Error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
