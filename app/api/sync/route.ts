import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { decrypt } from "@/lib/encryption";
import { syncEventsToCalendar } from "@/lib/google-calendar";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Increase max duration for syncing multiple users

export const GET = async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret');

    // Simple security check (use a secret defined in .env)
    if (secret !== process.env.SYNC_SECRET && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // 1. Get all users that need sync
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, vlomis_username, vlomis_password, google_access_token');

        if (userError) throw userError;

        interface SyncResult {
            username: string;
            success: boolean;
            entries?: number;
            error?: string;
            googleSync?: boolean;
            googleSyncError?: string;
        }

        const results: SyncResult[] = [];

        // 2. Sync for each user
        // Note: In a production environment with many users, this should be a queue
        for (const user of users || []) {
            try {
                console.log(`Syncing for user: ${user.vlomis_username}`);

                // We call our own API route to reuse the scraping logic
                // This also handles base64 encoding if needed, or we can just call the logic directly
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
                const decryptedPassword = decrypt(user.vlomis_password);
                const syncRes = await fetch(`${baseUrl}/api/vlomis?username=${encodeURIComponent(user.vlomis_username)}&password=${encodeURIComponent(decryptedPassword)}`);
                const syncData = await syncRes.json();

                results.push({
                    username: user.vlomis_username,
                    success: syncData.success,
                    entries: syncData.data?.length || 0,
                    googleSync: false
                });

                // Sync to Google Calendar if connected
                if (user.google_access_token && syncData.data?.length > 0) {
                    try {
                        console.log(`Syncing to Google Calendar for ${user.vlomis_username}`);
                        await syncEventsToCalendar(user.id, syncData.data);
                        results[results.length - 1].googleSync = true;
                    } catch (calErr: any) {
                        console.error(`Google Calendar sync error for ${user.vlomis_username}:`, calErr);
                        results[results.length - 1].googleSyncError = calErr.message;
                    }
                }

                // Update last_sync_at
                await supabase
                    .from('users')
                    .update({ last_sync_at: new Date().toISOString() })
                    .eq('vlomis_username', user.vlomis_username);

            } catch (err: any) {
                results.push({
                    username: user.vlomis_username,
                    success: false,
                    error: err.message
                });
            }
        }

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            results
        });

    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
};
