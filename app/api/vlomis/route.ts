import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import puppeteer from "puppeteer-core";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const VLOMIS_BASE_URL = "https://mip.agentschapmdk.be/Vlomis";
const LOGIN_URL = `${VLOMIS_BASE_URL}/Login.aspx`;
const PLANNING_URL = `${VLOMIS_BASE_URL}/Planning.aspx`;

interface PlanningEntry {
  id?: string;
  vlomis_entry_id?: string;
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
  // Use hardcoded browserless token directly
  const { BROWSERLESS_TOKEN } = await import('@/lib/supabase-config')
  const browserWSEndpoint = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`

  console.log("[Scraper] Connecting to browserless service...")
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint: browserWSEndpoint,
    })
    console.log("[Scraper] Successfully connected to browserless")
    return browser
  } catch (err: any) {
    console.error("[Scraper] Failed to connect to browserless:", err.message)
    throw new Error(`Failed to connect to browserless service: ${err.message}`)
  }
}

async function scrapeVlomis(credentials?: { username?: string; password?: string }): Promise<{ success: boolean; data: PlanningEntry[]; realName?: string; realFunctie?: string; error?: string; debug: string[] }> {
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

    // Ensure we are actually on the login page or if we are already logged in
    const title = await page.title();
    log(`Current page title: ${title}`);

    const loginButtonPresent = await page.$('input[name*="LoginButton"]');
    if (loginButtonPresent) {
      log("Login form found. Entering credentials...");
      await page.type('input[name*="UserName"]', username);
      await page.type('input[name*="Password"]', password);
      await Promise.all([
        page.click('input[name*="LoginButton"]'),
        page.waitForNavigation({ waitUntil: "networkidle0" }),
      ]);

      const afterLoginTitle = await page.title();
      log(`Page title after login attempt: ${afterLoginTitle}`);
    } else {
      log("No login form found. Checking if session is already active...");
    }

    log(`Navigating to planning: ${PLANNING_URL}`);
    // Random delay between 1-3s to look more human
    await new Promise(res => setTimeout(res, 1000 + Math.random() * 2000));
    const response = await page.goto(PLANNING_URL, { waitUntil: "networkidle2" });

    if (response && response.status() === 429) {
      log("Vlomis returned 429 (Too Many Requests).");
      return { success: false, data: [], error: "Too many requests (429) from Vlomis. Please wait a few minutes.", debug: debugLogs };
    }

    const planningTitle = await page.title();
    log(`Planning page title: ${planningTitle}`);

    if (planningTitle.includes("Login") || (await page.$('input[name*="Password"]'))) {
      log("Scrape failed: Redirected to login or password field remains.");
      return { success: false, data: [], error: `Login failed or session expired (Title: ${planningTitle})`, debug: debugLogs };
    }

    // Set date range (Start of current month to +12 months)
    const today = new Date();
    const fromDate = new Date(today.getFullYear(), today.getMonth(), 1); // 1st of current month
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

      // OPTIMIZED: Wait for results table to populate instead of fixed 5s
      try {
        await page.waitForFunction(() => {
          const rows = document.querySelectorAll('tr');
          return rows.length > 5; // Basic check for results
        }, { timeout: 8000 });
      } catch (e) {
        // Fallback for cases where waitForFunction might fail
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Extract Data
    const entries = await page.evaluate((uname) => {
      const results: any[] = [];
      const rows = Array.from(document.querySelectorAll('tr'));

      const txt = (idx: number, cells: HTMLTableCellElement[]) => (cells[idx]?.textContent || "").trim();

      for (let i = 0; i < rows.length; i++) {
        const cells = Array.from(rows[i].querySelectorAll('td'));
        if (cells.length < 7) continue;

        const vanStr = txt(4, cells);
        const totStr = txt(5, cells);

        if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(vanStr)) {
          const datePart = vanStr.trim().split(/\s+/)[0];
          let registratiesoort = txt(6, cells);

          const rowStyle = rows[i].getAttribute('style')?.toLowerCase() || '';
          const isCyan = rowStyle.includes('#80ffff') || rowStyle.includes('cyan');
          const cell8 = cells[8];
          const hasDeleteBtn = cell8?.querySelector('.del') !== null || cell8?.querySelector('a[title*="schrappen"]') !== null;

          if ((isCyan || hasDeleteBtn) && registratiesoort.includes('Verlof')) {
            registratiesoort += ' (Aangevraagd)';
          }

          // Helper to convert DD/MM/YYYY HH:MM to UTC ISO (Robust)
          const convertToUTC = (dateStr: string): string => {
            try {
              const [dPart, tPart = '00:00'] = dateStr.trim().split(/\s+/);
              const [d, m, y] = dPart.split('/').map(n => parseInt(n));
              const [h, min] = tPart.split(':').map(n => parseInt(n));

              // UTC base
              const dateObj = new Date(Date.UTC(y, m - 1, d, h, min));

              // Brussels Offset (CET=+1, CEST=+2)
              let offset = 1;
              const mo = m - 1;
              if (mo > 2 && mo < 9) offset = 2;
              else if (mo === 2) {
                // Last Sunday of March
                const lastSun = d - dateObj.getUTCDay();
                if (lastSun > 25 || (lastSun === 25 && h >= 1)) offset = 2;
              } else if (mo === 9) {
                // Last Sunday of October
                const lastSun = d - dateObj.getUTCDay();
                if (lastSun < 25 || (lastSun === 25 && h < 1)) offset = 2;
              }

              return new Date(dateObj.getTime() - (offset * 60 * 60 * 1000)).toISOString();
            } catch (e) {
              return dateStr;
            }
          };

          const vanUTC = convertToUTC(vanStr);
          const totUTC = convertToUTC(totStr);
          const ISOdate = datePart.split('/').reverse().join('-');
          const stableVanTime = (vanStr.includes(' ') ? vanStr.split(' ')[1] : '00:00').padStart(5, '0');

          results.push({
            vlomis_entry_id: `${uname}-${ISOdate}-${registratiesoort}-${stableVanTime}`,
            date: ISOdate,
            registratiesoort: registratiesoort.trim(),
            van: vanUTC,
            tot: totUTC,
            medewerker: uname,
            functie: txt(2, cells),
            afdeling: txt(1, cells),
            vaartuig: txt(3, cells),
          });
        }
      }
      return results;
    }, username) as PlanningEntry[];

    // Extract & Format Real Name
    const rawRealName = await page.evaluate(() => {
      const el = document.querySelector('input#ctl00_ContentPlaceHolder1_ctl01_select_per_id') as HTMLInputElement;
      return el ? el.value.trim() : null;
    });

    // Format "VAN OSTAEYEN Luc" -> "Luc Van Ostaeyen"
    const formatName = (name: string | null) => {
      if (!name) return null;
      const parts = name.trim().split(/\s+/);

      // Heuristic: Vlomis uses ALL CAPS for surname parts, Title Case for first name
      const surnameParts: string[] = [];
      const firstnameParts: string[] = [];

      for (const part of parts) {
        // Check if fully uppercase (and length > 1 or common prefix like VAN)
        // Or if simple check: is equal to uppercase version?
        // But some names like "DE" or "LE" are short.
        if (part === part.toUpperCase() && /[A-Z]/.test(part)) {
          surnameParts.push(part);
        } else {
          firstnameParts.push(part);
        }
      }

      const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

      // If we found both parts, format nicely
      if (surnameParts.length > 0 && firstnameParts.length > 0) {
        const first = firstnameParts.join(" ");
        const last = surnameParts.map(titleCase).join(" ");
        return `${first} ${last}`;
      }

      // Fallback for simple 2-part names if heuristic fails (e.g. all caps or all lower)
      if (parts.length >= 2) {
        // Assume standard "Last First" order from Vlomis
        // Take all but last word as Surname? Or first as Surname?
        // Vlomis standard: "ACHTERNAAM Voornaam"
        const last = parts[0];
        const first = parts.slice(1).join(" ");
        // This was the old buggy logic, but better than nothing for "simple" names
        // Actually, if we are here, likely the Case detection failed.
        return name;
      }

      return name;
    };
    const realName = formatName(rawRealName);

    console.log(`[Scraper] Extracted raw name: '${rawRealName}', Formatted to: '${realName}'`);

    const realFunctie = entries.length > 0 ? entries[0].functie : undefined;

    log(`Extracted ${entries.length} entries. Real name: ${realName || 'not found'}, Functie: ${realFunctie || 'not found'}`);
    return { success: true, data: entries, realName: realName || undefined, realFunctie: realFunctie, debug: debugLogs };

  } catch (error: any) {
    return { success: false, data: [], error: error.message, debug: debugLogs };
  } finally {
    if (browser) await browser.close();
  }
}

// Shared logic for both GET and POST
async function handleRequest(request: Request) {
  try {
    let usernameParam: string | null = null;
    let passwordParam: string | null = null;
    let forceSync = false;
    let syncLimit = 500;

    // Handle both GET (URL) and POST (JSON)
    if (request.method === 'POST') {
      const body = await request.json();
      usernameParam = body.username;
      passwordParam = body.password;
      forceSync = body.force === true;
      if (body.limit) syncLimit = parseInt(body.limit);
    } else {
      const { searchParams } = new URL(request.url);
      usernameParam = searchParams.get('username');
      passwordParam = searchParams.get('password');
      forceSync = searchParams.get('force') === 'true';
      const limitParam = searchParams.get('limit');
      if (limitParam) syncLimit = parseInt(limitParam);
    }

    const { savePlanningEntries, getPlanningEntries, getFirstDataDate, cleanupOldEntries } = await import('@/lib/planning-db');
    const { getOrCreateUser } = await import('@/lib/user-db');
    const { supabaseAdmin } = await import('@/lib/supabase-admin');
    const { decrypt } = await import('@/lib/encryption');

    console.log(`[API] ${request.method} /api/vlomis for user: ${usernameParam}`);

    // 1. Identify User
    let currentUser: any = null;
    let username = usernameParam || 'User';
    let password = passwordParam || '';

    if (usernameParam) {
      // 1. Try to find EXISTING user
      const { getUserByUsername } = await import('@/lib/user-db'); // Dynamic import to ensure we get the latest
      const userResult = await getUserByUsername(usernameParam, supabaseAdmin);

      if (userResult.success && userResult.user) {
        currentUser = userResult.user;

        // Update password if provided and different (only for existing users)
        if (passwordParam) {
          // We can do this async or let the background task handle it, 
          // but strictly speaking we should probably only update password if login succeeds?
          // For now, let's leave password update for the "Success" block to be safe against trash passwords on existing accounts too?
          // Actually, the previous getOrCreateUser updated it immediately. 
          // Let's defer password update to AFTER successful scrape to be clean.
        }
      }
    }

    // CRITICAL: Ensure 'username' variable reflects the identified user
    if (currentUser?.vlomis_username) {
      username = currentUser.vlomis_username;
    }

    // SECURITY: Decrypt stored password if logic requires it
    // If no password provided in request, try to get it from DB
    if (!password && currentUser?.vlomis_password) {
      try {
        password = decrypt(currentUser.vlomis_password);
      } catch (e) {
        console.error('[API] Failed to decrypt stored password:', e);
      }
    }

    console.log(`[API] Identified User: ${username} (ID: ${currentUser?.id || 'null'})`);

    // 2. Decide if we should scrape
    const SYNC_INTERVAL = (currentUser?.sync_interval_minutes || 60) * 60 * 1000;
    const lastSync = currentUser?.last_sync_at ? new Date(currentUser.last_sync_at).getTime() : 0;
    const now = Date.now();

    // Force scrape if it's a POST request (Login or Manual Sync) because we need to VALIDATE credentials.
    // If we rely on cache for a login attempt with wrong password, we might successfully "login" (from cache)
    // even though the provided password is wrong.
    const isLoginOrForce = request.method === 'POST';
    let shouldScrape = isLoginOrForce || (now - lastSync > SYNC_INTERVAL) || !currentUser;
    let skipReason = "Data is fresh (within interval)";

    let liveData: PlanningEntry[] = [];
    let isLive = false;
    let debugLogs: string[] = [];
    let scrapeSuccess = false;
    let scrapeError: string | undefined = undefined;

    // 3. Scrape if needed
    if (shouldScrape) {
      console.log(`[Sync] Starting scrape for ${username}...`);
      const result = await scrapeVlomis({ username, password: password || undefined });
      debugLogs = result.debug;
      scrapeSuccess = result.success;
      scrapeError = result.error;
      if (result.success) {
        liveData = result.data;
        isLive = true;

        // --- SUCCESSFUL LOGIN/SCRAPE ---
        // Now it is safe to Create or Update the user in the DB
        if (!currentUser && username && password) {
          console.log(`[Sync] Creating NEW user ${username} after successful verification.`);
          const userResult = await getOrCreateUser(username, password, supabaseAdmin);
          if (userResult.success) currentUser = userResult.user;
        } else if (currentUser && password) {
          // Update password for existing user if changed
          // (We reuse getOrCreateUser logic which handles update, or do it manually)
          // Using getOrCreateUser is easiest as it handles encryption check
          await getOrCreateUser(username, password, supabaseAdmin);
        }
      } else {
        console.error(`[Sync] Scrape failed: ${result.error}`);
        // CRITICAL: If this is a POST (Login attempt or Force Sync) and it failed due to credentials,
        // we MUST return an error to the client instead of falling back to cache.
        const isLoginError = result.error?.toLowerCase().includes("login failed") || result.error?.toLowerCase().includes("missing");

        // If it's a specific login error, OR if it's a new user who has no data yet (and scrape failed)
        if (request.method === 'POST' && (isLoginError || !currentUser)) {
          return NextResponse.json({
            success: false,
            error: result.error || "Login mislukt of Vlomis onbereikbaar",
            debug: debugLogs
          }, { status: 401 });
        }
      }

      // --- BACKGROUND PERSISTENT TASKS ---
      waitUntil((async () => {
        console.log(`[Background] Starting persistent tasks for ${username}...`);

        // Save to DB (only if scrape was successful and data exists)
        if (scrapeSuccess && liveData.length > 0) {
          const saveRes = await savePlanningEntries(liveData, currentUser?.id, supabaseAdmin);
          if (saveRes.success) {
            console.log(`[Background] Saved ${liveData.length} entries to DB.`);
          }
        }

        // Update user metadata (last_sync_at should always be updated after an attempt)
        if (currentUser?.id) {
          const updateData: any = { last_sync_at: new Date().toISOString() };
          // Only update display_name if scrape was successful and realName is available
          if (scrapeSuccess && result.realName && currentUser.display_name !== result.realName) {
            updateData.display_name = result.realName;
          }
          await supabaseAdmin.from('users').update(updateData).eq('id', currentUser.id);
        }

        // Cleanup old entries (ONLY if scrape was successful to prevent data wipe on failed sync)
        if (scrapeSuccess) {
          await cleanupOldEntries(username, currentUser?.id, supabaseAdmin);
        }
      })());
    } else {
      // console.log(`[Sync] Skipped: ${skipReason}`);
    }

    // 4. Determine Source of Truth
    // If we just scraped (liveData), use that immediately to avoid DB race conditions.
    // Otherwise, fetch from DB.
    let rawData: PlanningEntry[] = [];

    if (isLive && liveData.length > 0) {
      console.log(`[API] Using FRESH live/simulated data (${liveData.length} items)`);
      rawData = liveData;
    } else {
      const dbResult = await getPlanningEntries(username, undefined, undefined, currentUser?.id, supabaseAdmin);
      rawData = dbResult.success ? dbResult.data : [];
      console.log(`[API] Using CACHED DB data (${rawData.length} items)`);
    }

    const firstDate = await getFirstDataDate(username, currentUser?.id, supabaseAdmin);

    // Deduplicate entries (just in case)
    const seen = new Set();
    let finalData = rawData.filter(entry => {
      const key = `${entry.van}-${entry.tot}-${entry.registratiesoort}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[API] Final Dataset: ${rawData.length} entries, Deduplicated to: ${finalData.length}`);

    // --- Google Calendar Sync (Self-Healing & Proactive) ---
    let googleSyncResult = { success: false, message: "", error: "" };
    if (finalData.length > 0 && currentUser?.google_access_token) {
      // Trigger if: forced (Vernieuwen), OR just scraped successfully, OR no calendar yet
      const needsSync = forceSync || isLive || !currentUser.google_calendar_id;

      if (needsSync) {
        try {
          console.log(`[Google] Starting sync for user ${username} (isLive: ${isLive}, force: ${forceSync})...`);
          const { syncEventsToCalendar } = await import('@/lib/google-calendar');

          // INCREASE LIMIT for new users or manual refreshes to ensure they see future items
          // Base: 25. Forced or New: 100.
          const dynamicLimit = (forceSync || !currentUser.google_calendar_id) ? 100 : syncLimit;

          waitUntil((async () => {
            await syncEventsToCalendar(currentUser.id, finalData, dynamicLimit);
            console.log(`[Background] Google Sync finished for ${username}.`);
          })());

          googleSyncResult = {
            success: true,
            message: `Sync gestart (${finalData.length} items)...`,
            error: ""
          };
        } catch (e: any) {
          googleSyncResult = {
            success: false,
            message: "Google Calendar sync initialization failed",
            error: e.message || String(e)
          };
        }
      } else {
        googleSyncResult = {
          success: true,
          message: "Calendar up to date",
          error: ""
        };
      }
    } else if (!currentUser?.google_access_token) {
      googleSyncResult = {
        success: false,
        message: "Google Calendar not connected",
        error: "Connect your Google account in settings"
      };
    }

    // Extract metadata from the latest data if available
    const latestEntry = finalData.length > 0 ? finalData[0] : null;
    const userFunction = latestEntry?.functie || "";
    const userDepartment = latestEntry?.afdeling || "";

    // Debug: Log the outcome
    console.log(`[API] Response for ${username}: ${finalData.length} entries. Function: ${userFunction}, Dept: ${userDepartment}. Scrape: ${scrapeSuccess ? 'OK' : 'Fail/Skip'}`);

    // Return Response
    return NextResponse.json({
      success: true,
      data: finalData,
      isLive,
      skipped: !shouldScrape,
      message: shouldScrape
        ? (scrapeSuccess ? "Vlomis data refreshed" : "Scrape failed, showing cached")
        : "Sync skipped (cached)",
      historicalFrom: firstDate,
      user: currentUser?.display_name || username,
      userId: currentUser?.id,
      userFunction,
      userDepartment,
      googleConnected: !!currentUser?.google_access_token,
      googleSync: googleSyncResult,
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
}

export const GET = handleRequest;
export const POST = handleRequest;
