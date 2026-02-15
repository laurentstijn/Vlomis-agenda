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
    const result = await hardResetUser(username);

    if (result.success) {
        return NextResponse.json({
            success: true,
            message: `User ${username} has been hard reset. All entries deleted and tokens cleared.`
        });
    } else {
        return NextResponse.json({
            success: false,
            error: result.error
        }, { status: 500 });
    }
}
