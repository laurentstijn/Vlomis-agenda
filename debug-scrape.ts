
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
const VLOMIS_BASE_URL = "https://mip.agentschapmdk.be/Vlomis";
const LOGIN_URL = `${VLOMIS_BASE_URL}/Login.aspx`;
const PLANNING_URL = `${VLOMIS_BASE_URL}/Planning.aspx`;

async function getBrowser() {
    // Attempt to find Chrome on macOS
    return puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
}

async function debugScrape() {
    const username = process.env.VLOMIS_USERNAME;
    const password = process.env.VLOMIS_PASSWORD;

    if (!username || !password) {
        console.error("No credentials found in .env.local");
        return;
    }

    console.log(`Debug scraping for user: ${username}`);

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        // Login
        console.log("Logging in...");
        await page.goto(LOGIN_URL, { waitUntil: "networkidle0" });
        await page.type('input[name*="UserName"]', username);
        await page.type('input[name*="Password"]', password);
        await Promise.all([
            page.click('input[name*="LoginButton"]'),
            page.waitForNavigation({ waitUntil: "networkidle0" }),
        ]);

        // Planning
        console.log("Navigating to Planning...");
        await page.goto(PLANNING_URL, { waitUntil: "networkidle0" });

        // Set Date Range to ensure we see future data
        const today = new Date();
        const fromDate = new Date(today);
        const toDate = new Date(today);
        toDate.setMonth(today.getMonth() + 12); // Look 12 months ahead

        const formatDate = (d: Date) => {
            const day = d.getDate().toString().padStart(2, "0");
            const month = (d.getMonth() + 1).toString().padStart(2, "0");
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };

        const vanInput = await page.$('input[name*="van$txtDate"]');
        if (vanInput) {
            console.log(`Setting range: ${formatDate(fromDate)} - ${formatDate(toDate)}`);
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
            console.log("Waiting for update...");
            await new Promise(r => setTimeout(r, 5000));
        }

        // Dump HTML of rows
        console.log("Extracting HTML of rows...");
        const rowHtmls = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('tr'));
            return rows.map(r => r.outerHTML);
        });

        console.log("--- START ROW HTML DUMP ---");
        // Find interesting rows
        const interestingRows = rowHtmls.filter(html => html.includes('Verlof'));

        if (interestingRows.length === 0) {
            console.log("No Verlof rows found in next 12 months.");
        } else {
            console.log(`Found ${interestingRows.length} VERLOF rows.`);
            interestingRows.slice(0, 5).forEach(html => {
                console.log(html);
                console.log("---------------------------------------------------");
            });
        }
        console.log("--- END ROW HTML DUMP ---");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
}

debugScrape();
