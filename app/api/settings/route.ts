import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const username = searchParams.get("username");

        if (!username) {
            return NextResponse.json(
                { success: false, error: "Username required" },
                { status: 400 }
            );
        }

        const { data: user, error } = await supabase
            .from("users")
            .select("sync_interval_minutes, last_synced_at")
            .eq("vlomis_username", username)
            .single();

        if (error) {
            console.error("Error fetching user settings:", error);
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            settings: {
                sync_interval_minutes: user.sync_interval_minutes || 60, // Default 60
                last_synced_at: user.last_synced_at,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { username, sync_interval_minutes } = body;

        if (!username || !sync_interval_minutes) {
            return NextResponse.json(
                { success: false, error: "Missing required fields" },
                { status: 400 }
            );
        }

        // Validate interval (minimum 30 mins)
        const interval = parseInt(sync_interval_minutes);
        if (isNaN(interval) || interval < 30) {
            return NextResponse.json(
                { success: false, error: "Minimum interval is 30 minutes" },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from("users")
            .update({ sync_interval_minutes: interval })
            .eq("vlomis_username", username);

        if (error) {
            console.error("Error updating user settings:", error);
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Instellingen opgeslagen",
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
