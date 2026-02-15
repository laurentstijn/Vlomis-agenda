import { NextResponse } from "next/server";
import puppeteer from "puppeteer-core";

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VLOMIS_BASE_URL = "https://mip.agentschapmdk.be/Vlomis";
const LOGIN_URL = `${VLOMIS_BASE_URL}/Login.aspx`;
const PLANNING_URL = `${VLOMIS_BASE_URL}/Planning.aspx`;

interface PlanningEntry {
  id?: string;
  date: string;
  registratiesoort: string;
  van: string;
  tot: string;
  medewerker: string;
  functie: string;
  afdeling: string;
  vaartuig: string;
}

async function getBrowser() {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    return puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  }
  if (process.env.BROWSER_WS_ENDPOINT) {
    console.log("Connecting to remote browser...");
    return puppeteer.connect({
      browserWSEndpoint: process.env.BROWSER_WS_ENDPOINT,
    });
  }
  throw new Error("Missing BROWSER_WS_ENDPOINT environment variable in production!");
}

async function scrapeVlomis(credentials?: { username?: string; password?: string }): Promise<{ success: boolean; data: PlanningEntry[]; error?: string; debug: string[] }> {
  const debugLogs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    debugLogs.push(`[${new Date().toISOString()}] ${msg}`);
  };

  const username = credentials?.username || process.env.VLOMIS_USERNAME;
  const password = credentials?.password || process.env.VLOMIS_PASSWORD;

  if (!username || !password) {
    return { success: false, data: [], error: "Missing Vlomis credentials", debug: debugLogs };
  }

  let browser = null;

  try {
    log("Launching browser...");
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'nl-BE,nl;q=0.9,en-US;q=0.8,en;q=0.7' });

    log(`Navigating to login: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle0" });

    const loginButtonPresent = await page.$('input[name*="LoginButton"]');
    if (loginButtonPresent) {
      log("Login form found. Entering credentials...");
      await page.type('input[name*="UserName"]', username);
      await page.type('input[name*="Password"]', password);
      await Promise.all([
        page.click('input[name*="LoginButton"]'),
        page.waitForNavigation({ waitUntil: "networkidle0" }),
      ]);
    } else {
      log("No login form found. Maybe already logged in?");
    }

    log(`Navigating to planning: ${PLANNING_URL}`);
    await page.goto(PLANNING_URL, { waitUntil: "networkidle0" });

    const planningTitle = await page.title();
    if (planningTitle.includes("Login") || (await page.$('input[name*="Password"]'))) {
      return { success: false, data: [], error: "Login failed or session expired", debug: debugLogs };
    }

    // Set date range (Current month to +12 months)
    const today = new Date();
    const fromDate = new Date(today);
    const toDate = new Date(today);
    toDate.setMonth(today.getMonth() + 12);

    const formatDate = (d: Date) => {
      const day = d.getDate().toString().padStart(2, "0");
      const month = (d.getMonth() + 1).toString().padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const vanInput = await page.$('input[name*="van$txtDate"]');
    const totInput = await page.$('input[name*="tot$txtDate"]');
    const searchBtn = await page.$('input[name*="btnSearch"]');

    if (vanInput && totInput && searchBtn) {
      await page.evaluate((val) => {
        const el = document.querySelector('input[name*="van$txtDate"]') as HTMLInputElement;
        if (el) el.value = val;
      }, formatDate(fromDate));

      await page.evaluate((val) => {
        const el = document.querySelector('input[name*="tot$txtDate"]') as HTMLInputElement;
        if (el) el.value = val;
      }, formatDate(toDate));

      page.on('dialog', async dialog => await dialog.accept());
      await page.click('input[name*="btnSearch"]');
      await new Promise(r => setTimeout(r, 5000)); // Wait for AJAX
    }

    // Extract Data
    const entries = await page.evaluate((uname) => {
      const results: any[] = [];
      const rows = Array.from(document.querySelectorAll('tr'));
      for (let i = 0; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 7) continue;

        const txt = (idx: number) => (cells[idx]?.textContent || "").trim();
        const van = txt(4);
        const tot = txt(5);

        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(van) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(tot)) {
          const datePart = van.split(' ')[0];
          let registratiesoort = txt(6);

          const rowStyle = rows[i].getAttribute('style')?.toLowerCase() || '';
          const isCyan = rowStyle.includes('#80ffff') || rowStyle.includes('cyan');
          const cell8 = cells[8];
          const hasDeleteBtn = cell8?.querySelector('.del') !== null || cell8?.querySelector('a[title*="schrappen"]') !== null;

          if ((isCyan || hasDeleteBtn) && registratiesoort.includes('Verlof')) {
            registratiesoort += ' (Aangevraagd)';
          }

          results.push({
            date: datePart,
            registratiesoort: registratiesoort,
            van: van,
            tot: tot,
            medewerker: uname,
            functie: txt(2),
            afdeling: txt(1),
            vaartuig: txt(3),
          });
        }
      }
      return results;
    }, username);

    log(`Extracted ${entries.length} entries.`);
    return { success: true, data: entries, debug: debugLogs };

  } catch (error: any) {
    return { success: false, data: [], error: error.message, debug: debugLogs };
  } finally {
    if (browser) await browser.close();
  }
}

export const GET = async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const usernameParam = searchParams.get('username');
    const passwordParam = searchParams.get('password');
    const forceSync = searchParams.get('force') === 'true';

    const { savePlanningEntries, getPlanningEntries, getFirstDataDate, cleanupOldEntries } = await import('@/lib/planning-db');
    const { getOrCreateUser } = await import('@/lib/user-db');
    const { supabase } = await import('@/lib/supabase');

    console.log(`[API] GET /api/vlomis params: usernameParam=${usernameParam}, forceSync=${forceSync}`);

    // 1. Identify User
    let currentUser: any = null;
    let username = usernameParam || process.env.VLOMIS_USERNAME || 'User';
    let password = passwordParam || process.env.VLOMIS_PASSWORD;

    if (usernameParam) {
      const userResult = await getOrCreateUser(usernameParam, passwordParam || undefined);
      if (userResult.success) currentUser = userResult.user;
    } else if (process.env.VLOMIS_USERNAME) {
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('vlomis_username', process.env.VLOMIS_USERNAME)
        .single();
      if (user) currentUser = user;
    }

    // CRITICAL: Ensure 'username' variable reflects the identified user
    if (currentUser?.vlomis_username) {
      username = currentUser.vlomis_username;
    }

    console.log(`[API] Identified User: ${username} (ID: ${currentUser?.id || 'null'})`);

    // 2. Decide if we should scrape
    let shouldScrape = true;
    let skipReason = "";

    // Always fetch DB first to check if empty
    const dbResultInit = await getPlanningEntries(username, undefined, undefined, currentUser?.id);
    const dbHasData = dbResultInit.success && dbResultInit.data.length > 0;

    console.log(`[API] Initial DB Check: ${dbResultInit.data.length} entries found.`);

    if (!dbHasData) {
      // FAIL-SAFE: If DB is empty, FORCE SCRAPE regardless of interval
      shouldScrape = true;
      console.log(`[Sync] Initial DB empty. Forcing scrape.`);
    } else if (currentUser?.last_synced_at && currentUser?.sync_interval_minutes && !forceSync) {
      const lastSync = new Date(currentUser.last_synced_at);
      const now = new Date();
      const diffMinutes = (now.getTime() - lastSync.getTime()) / (1000 * 60);

      if (diffMinutes < currentUser.sync_interval_minutes) {
        shouldScrape = false;
        skipReason = `Interval not passed (${Math.round(diffMinutes)} < ${currentUser.sync_interval_minutes})`;
      }
    }

    let liveData: PlanningEntry[] = [];
    let isLive = false;
    let debugLogs: string[] = [];
    let scrapeSuccess = false;

    // 3. Scrape if needed
    if (shouldScrape) {
      console.log(`[Sync] Starting scrape for ${username}...`);
      const result = await scrapeVlomis({ username, password: password || undefined });
      debugLogs = result.debug;
      scrapeSuccess = result.success;

      if (result.success) {
        liveData = result.data;
        isLive = true;

        // Save to DB
        const saveRes = await savePlanningEntries(result.data, currentUser?.id);
        if (!saveRes.success) {
          console.error(`[Sync] Save DB failed: ${saveRes.error}`);
        } else {
          console.log(`[Sync] Successfully saved ${result.data.length} entries to DB.`);
        }

        // Update last_synced_at
        if (currentUser?.id) {
          await supabase.from('users').update({ last_synced_at: new Date().toISOString() }).eq('id', currentUser.id);
        }

        await cleanupOldEntries(username, currentUser?.id);

        if (currentUser?.google_access_token) {
          const { syncEventsToCalendar } = await import('@/lib/google-calendar');
          syncEventsToCalendar(currentUser.id, result.data).catch(e => console.error("Google Sync Error", e));
        }

      } else {
        console.error(`[Sync] Scrape failed: ${result.error}`);
      }
    } else {
      console.log(`[Sync] Skipped: ${skipReason}`);
    }

    // 4. ALWAYS Fetch from DB (Single Source of Truth + Cache)
    const firstDate = await getFirstDataDate(username, currentUser?.id);
    const dbResult = await getPlanningEntries(username, undefined, undefined, currentUser?.id);

    let finalData = dbResult.success ? dbResult.data : [];
    console.log(`[API] Final DB Fetch: ${finalData.length} entries.`);

    // Fallback: If DB fetch failed or empty but we JUST scraped data successfully, use the live data directly
    if (finalData.length === 0 && isLive && liveData.length > 0) {
      console.log(`[Sync] DB empty/failed, using live data as fallback.`);
      finalData = liveData;
    }

    // Return Response
    return NextResponse.json({
      success: true,
      data: finalData,
      isLive,
      skipped: !shouldScrape,
      message: shouldScrape
        ? (scrapeSuccess ? "Live sync successful" : "Scrape failed, showing cached")
        : "Sync skipped (cached)",
      historicalFrom: firstDate,
      user: currentUser?.display_name || username,
      userId: currentUser?.id,
      googleConnected: !!currentUser?.google_access_token,
      debug: debugLogs,
      fetchedAt: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("[API] Critical Error:", error);
    return NextResponse.json({
      success: false,
      error: "Internal Server Error",
      details: error.message
    }, { status: 500 });
  }
};
