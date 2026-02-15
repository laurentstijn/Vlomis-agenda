import { NextResponse } from "next/server";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

// Tell Next.js to use the Edge Runtime or Node.js runtime
// Puppeteer requires Node.js runtime, not Edge
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Set max duration for the function (in seconds)

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

// Helper to get browser instance
async function getBrowser() {
  const isDev = process.env.NODE_ENV === "development";

  // In development, we use the local Chrome installation
  if (isDev) {
    return puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true, // Set to false to see the browser in action during dev
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // Validated local path
    });
  }

  // In production (Vercel), we use @sparticuz/chromium-min
  // We point to a remote URL to bypass local file system issues
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(
      "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"
    ),
    headless: chromium.headless,
  });
}

async function scrapeVlomis(credentials?: { username?: string; password?: string }): Promise<{ success: boolean; data: PlanningEntry[]; error?: string; debug: string[] }> {
  const debugLogs: string[] = [];
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
    // Credentials already checked above


    log("Launching browser...");
    browser = await getBrowser();
    const page = await browser.newPage();

    // Set viewport to a standard desktop size
    // Set viewport to a standard desktop size
    await page.setViewport({ width: 1280, height: 800 });

    // Set User-Agent to avoid detection/headless formatting issues
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    // Set Locale to Ensure Belgian Date Formats (dd/mm/yyyy)
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'nl-BE,nl;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    // Step 1: Login
    log(`Navigating to login: ${LOGIN_URL}`);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle0" });

    // Check if we're actually on the login page (or already logged in/redirected)
    const title = await page.title();
    log(`Page title: ${title}`);

    // Check if login form is present
    const loginButtonPresent = await page.$('input[name*="LoginButton"]');

    if (loginButtonPresent) {
      log("Login form found. Entering credentials...");

      // Type username
      await page.type('input[name*="UserName"]', username);

      // Type password
      await page.type('input[name*="Password"]', password);

      // Click login and wait for navigation
      log("Submitting login form...");
      await Promise.all([
        page.click('input[name*="LoginButton"]'),
        page.waitForNavigation({ waitUntil: "networkidle0" }),
      ]);

      log("Login submitted. Checking result...");
    } else {
      log("No login form found. Maybe already logged in?");
    }

    // Step 2: Navigate to Planning
    log(`Navigating to planning: ${PLANNING_URL}`);
    await page.goto(PLANNING_URL, { waitUntil: "networkidle0" });

    const planningTitle = await page.title();
    log(`Planning page title: ${planningTitle}`);

    // Check if we were redirected back to login
    if (planningTitle.includes("Login") || (await page.$('input[name*="Password"]'))) {
      log("Redirected to login page. Login failed.");
      return { success: false, data: [], error: "Login failed or session expired", debug: debugLogs };
    }

    // Step 3: Search logic
    // Even if rows exist, we might want to ensure date range.
    // But let's check row count first.
    const rowCount = await page.evaluate(() => {
      return document.querySelectorAll('tr').length;
    });

    log(`Initial row count: ${rowCount}`);

    // If few rows, or just to be safe, set the date range.
    // NOTE: Vlomis only allows querying from the current month forward!
    log("Setting date range...");

    const today = new Date();
    const fromDate = new Date(today); // Start from today
    const toDate = new Date(today);
    toDate.setMonth(today.getMonth() + 12); // +12 months forward

    const formatDate = (d: Date) => {
      const day = d.getDate().toString().padStart(2, "0");
      const month = (d.getMonth() + 1).toString().padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Find inputs (robust selectors)
    const vanInput = await page.$('input[name*="van$txtDate"]');
    const totInput = await page.$('input[name*="tot$txtDate"]');
    const searchBtn = await page.$('input[name*="btnSearch"]');

    if (vanInput && totInput && searchBtn) {
      // Clear and type
      await page.evaluate((val) => {
        const el = document.querySelector('input[name*="van$txtDate"]') as HTMLInputElement;
        if (el) el.value = val;
      }, formatDate(fromDate));

      await page.evaluate((val) => {
        const el = document.querySelector('input[name*="tot$txtDate"]') as HTMLInputElement;
        if (el) el.value = val;
      }, formatDate(toDate));

      log(`Dates set: ${formatDate(fromDate)} - ${formatDate(toDate)}. Clicking search...`);

      // Set up dialog handler BEFORE clicking
      page.on('dialog', async dialog => {
        log(`Dialog appeared: ${dialog.message()}`);
        await dialog.accept();
      });

      // Click search
      // Wait for update
      await page.click('input[name*="btnSearch"]');
      log("Waiting 5s for AJAX update...");
      await new Promise(r => setTimeout(r, 5000));
    } else {
      log("Search inputs not found.");
    }

    // Step 4: Extract Data
    log("Extracting table data...");

    // Evaluate logic to parse the table
    const entries = await page.evaluate(() => {
      const results: any[] = [];
      const rows = Array.from(document.querySelectorAll('tr'));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = Array.from(row.querySelectorAll('td'));

        // Expected columns based on list view:
        // 0: Day (Vr)
        // 1: Dienst
        // 2: Functie
        // 3: Vaartuig
        // 4: Van (dd/mm/yyyy hh:mm)
        // 5: Tot
        // 6: Registratiesoort

        if (cells.length < 7) continue;

        const txt = (idx: number) => (cells[idx]?.textContent || "").trim();
        const van = txt(4);
        const tot = txt(5);

        // Check if col 4 and 5 look like dates
        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(van) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(tot)) {
          // It's a data row!
          const datePart = van.split(' ')[0]; // "13/02/2026"

          let registratiesoort = txt(6);

          // Check for "Pending" status based on HTML analysis
          // 1. Background color #80FFFF (Cyan)
          const row = rows[i];
          const rowStyle = row.getAttribute('style')?.toLowerCase() || '';
          const isCyan = rowStyle.includes('#80ffff') || rowStyle.includes('cyan');

          // 2. Delete button (class="del") in column index 8 (9th column)
          // <a ... class="del" title="Verlof schrappen" ...>
          const cell8 = cells[8];
          const hasDeleteBtn = cell8?.querySelector('.del') !== null ||
            cell8?.querySelector('a[title*="schrappen"]') !== null;

          // If either condition is met, mark as pending
          if ((isCyan || hasDeleteBtn) && registratiesoort.includes('Verlof')) {
            registratiesoort += ' (Aangevraagd)';
          }

          results.push({
            id: `scrape-${i}-${Math.random().toString(36).substring(7)}`,
            date: datePart,
            registratiesoort: registratiesoort,
            van: van,
            tot: tot,
            medewerker: "User",
            functie: txt(2),
            afdeling: txt(1), // Dienst
            vaartuig: txt(3),
          });
        }
      }

      return results;
    });

    log(`Extracted ${entries.length} entries.`);

    if (entries.length === 0) {
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500).replace(/\n/g, ' '));
      log(`⚠️ No entries found! Page preview: "${pageText}..."`);

      const tableHtml = await page.evaluate(() => document.querySelector('table')?.outerHTML.substring(0, 200) || "No table found");
      log(`Table HTML snippet: ${tableHtml}`);
    }

    return { success: true, data: entries, debug: debugLogs };

  } catch (error: any) {
    log(`Critical error: ${error.message}`);
    return { success: false, data: [], error: error.message, debug: debugLogs };
  } finally {
    if (browser) {
      log("Closing browser...");
      await browser.close();
    }
  }
}

export const GET = async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const usernameParam = searchParams.get('username');
    const passwordParam = searchParams.get('password');

    // Import helpers
    const { savePlanningEntries, getPlanningEntries, getFirstDataDate } = await import('@/lib/planning-db');
    const { getOrCreateUser } = await import('@/lib/user-db');

    // Determine current user
    let currentUser: any = null;

    // Case 1: Credentials provided via Query Params (Client App)
    if (usernameParam) {
      const userResult = await getOrCreateUser(usernameParam, passwordParam || undefined);
      if (userResult.success) {
        currentUser = userResult.user;
      }
    }
    // Case 2: No params -> Check environment variables (Cron Job / Background Sync)
    else if (process.env.VLOMIS_USERNAME) {
      // Try to find the user that matches the env var username
      const { data: user } = await (await import('@/lib/supabase')).supabase
        .from('users')
        .select('*')
        .eq('vlomis_username', process.env.VLOMIS_USERNAME)
        .single();

      if (user) {
        console.log(`[Cron] Identified user from env: ${user.vlomis_username}`);
        currentUser = user;
      }
    }

    const username = usernameParam || process.env.VLOMIS_USERNAME || 'User';
    const password = passwordParam || process.env.VLOMIS_PASSWORD;

    // Step 1: Scrape live data from Vlomis
    const result = await scrapeVlomis({ username, password: password || undefined });

    if (!result.success) {
      // Fallback to database
      const dbResult = await getPlanningEntries(username, undefined, undefined, currentUser?.id);
      if (dbResult.success && dbResult.data.length > 0) {
        return NextResponse.json({
          success: true,
          data: dbResult.data,
          isLive: false,
          source: 'database',
          message: 'Scraping failed, showing cached data',
          historicalFrom: currentUser?.id ? (await getFirstDataDate(username, currentUser.id)) : null,
          debug: result.debug,
          fetchedAt: new Date().toISOString()
        });
      }
      return NextResponse.json(result, { status: 500 });
    }

    // Step 2: Save to database
    const saveResult = await savePlanningEntries(result.data, currentUser?.id);

    // Step 2.5: Cleanup
    const { cleanupOldEntries } = await import('@/lib/planning-db');
    await cleanupOldEntries(username, currentUser?.id);

    // Step 3: Get first data date
    const firstDate = await getFirstDataDate(username, currentUser?.id);

    // Step 4: Combine database data
    let combinedData = result.data;
    if (firstDate) {
      const today = new Date().toISOString().split('T')[0];
      const dbResult = await getPlanningEntries(username, firstDate, today, currentUser?.id);

      if (dbResult.success) {
        const liveDataMap = new Map(
          result.data.map(entry => [`${entry.van}-${entry.tot}-${entry.registratiesoort}`, entry])
        );
        const dbOnlyData = dbResult.data.filter(
          entry => !liveDataMap.has(`${entry.van}-${entry.tot}-${entry.registratiesoort}`)
        );
        combinedData = [...dbOnlyData, ...result.data].sort((a, b) =>
          new Date(a.van).getTime() - new Date(b.van).getTime()
        );
      }
    }

    // Step 5: Sync to Google Calendar if connected
    if (currentUser?.google_access_token) {
      // Import dynamically to avoid circular dependencies if any
      const { syncEventsToCalendar } = await import('@/lib/google-calendar');
      // Fire and forget - or await if we want to ensure it's done
      // We await to catch errors and log them, but don't fail the request
      try {
        console.log(`[Google Calendar] Starting sync of ${combinedData.length} events for user ${username} (ID: ${currentUser.id})`);
        await syncEventsToCalendar(currentUser.id, combinedData);
        console.log(`[Google Calendar] Sync completed successfully for ${username}`);
      } catch (calError: any) {
        console.error('[Google Calendar] Failed to sync:', calError);
        console.error('[Google Calendar] Error details:', JSON.stringify(calError, null, 2));
        // We continue, as the user still wants their planning data
      }
    }

    return NextResponse.json({
      success: true,
      data: combinedData,
      isLive: true,
      source: 'combined',
      historicalFrom: firstDate,
      user: currentUser?.display_name || username,
      userId: currentUser?.id,
      googleConnected: !!currentUser?.google_access_token,
      debug: result.debug,
      fetchedAt: new Date().toISOString()
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: "Internal Server Error",
      details: error.message
    }, { status: 500 });
  }
};
