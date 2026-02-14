import { NextResponse } from "next/server";
import { getTokensFromCode, saveGoogleTokens } from "@/lib/google-calendar";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state"); // This contains the userId
    const error = searchParams.get("error");

    if (error) {
        return NextResponse.json({ error: "Google OAuth Error", details: error }, { status: 400 });
    }

    if (!code || !state) {
        return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
    }

    try {
        // Exchange code for tokens
        const tokens = await getTokensFromCode(code);

        // Save tokens to user (state is userId)
        await saveGoogleTokens(state, tokens);

        // Redirect back to main page with success query param
        return NextResponse.redirect(new URL("/?google_connected=true", request.url));
    } catch (err: any) {
        console.error("OAuth Callback Error:", err);
        return NextResponse.json({ error: "Failed to exchange token", details: err.message }, { status: 500 });
    }
}
