import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decrypt } from "@/lib/encryption";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow more time for batching

/**
 * CRON ORCHESTRATOR
 * This endpoint is called by GitHub Actions every 5 minutes (for testing/rapid updates).
 * It finds all users who are "due" for a sync and triggers them.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const secret = searchParams.get('secret');

        // Security check (CRON_SECRET should be set in environment)
        if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        console.log("[BatchSync] Starting orchestrator...");

        // 1. Fetch all users
        const { data: users, error } = await supabaseAdmin
            .from('users')
            .select('id, vlomis_username, vlomis_password, last_sync_at, sync_interval_minutes');

        if (error) throw error;
        if (!users || users.length === 0) {
            return NextResponse.json({ message: "No users found" });
        }

        console.log(`[BatchSync] Found ${users.length} users. Checking due status...`);

        const results = [];
        const now = new Date();

        for (const user of users) {
            // 2. Determine if user needs sync
            let shouldSync = false;
            // ENFORCED: 6 hours (360 minutes) for everyone, regardless of DB setting
            const interval = 360;

            if (!user.last_sync_at) {
                shouldSync = true;
            } else {
                const lastSync = new Date(user.last_sync_at);
                const diffMinutes = (now.getTime() - lastSync.getTime()) / (1000 * 60);
                if (diffMinutes >= interval) {
                    shouldSync = true;
                }
            }

            if (shouldSync) {
                console.log(`[BatchSync] User ${user.vlomis_username} is due for sync.`);

                try {
                    // Decrypt password
                    const password = user.vlomis_password ? decrypt(user.vlomis_password) : undefined;

                    if (!password) {
                        results.push({ user: user.vlomis_username, status: "skipped", reason: "No password" });
                        continue;
                    }

                    // Trigger the existing VLOMIS endpoint with force=true (POST)
                    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
                    const syncUrl = `${appUrl}/api/vlomis`;

                    console.log(`[BatchSync] Triggering sync for ${user.vlomis_username}...`);
                    const response = await fetch(syncUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: user.vlomis_username,
                            password: password,
                            force: true,
                            limit: 500
                        })
                    });
                    const data = await response.json();

                    results.push({
                        user: user.vlomis_username,
                        status: data.success ? "success" : "failed",
                        message: data.message || data.error
                    });

                    // Add a small delay between users to avoid rate limiting
                    // 2 seconds per user = 120 users in 4 minutes
                    await new Promise(r => setTimeout(r, 2000));

                } catch (err: any) {
                    console.error(`[BatchSync] Error syncing user ${user.vlomis_username}:`, err);
                    results.push({ user: user.vlomis_username, status: "error", error: err.message });
                }
            } else {
                results.push({ user: user.vlomis_username, status: "skipped", reason: "Interval not reached" });
            }
        }

        return NextResponse.json({
            success: true,
            processed: users.length,
            results
        });

    } catch (error: any) {
        console.error("[BatchSync] Orchestrator failed:", error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
