
function checkTime(dateString) {
    const now = dateString ? new Date(dateString) : new Date();
    const brusselsTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Brussels',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).format(now);

    const is7AM = brusselsTime.startsWith('07:');
    console.log(`Input: ${now.toISOString()} -> Brussels: ${brusselsTime} -> Is 7AM: ${is7AM}`);
    return is7AM;
}

console.log("Testing various times:");
checkTime("2026-02-27T05:30:00Z"); // 6:30 in Brussels (Winter)
checkTime("2026-02-27T06:00:00Z"); // 7:00 in Brussels (Winter) -> EXPECT TRUE
checkTime("2026-02-27T06:59:00Z"); // 7:59 in Brussels (Winter) -> EXPECT TRUE
checkTime("2026-02-27T07:00:00Z"); // 8:00 in Brussels (Winter)
checkTime("2026-06-27T04:30:00Z"); // 6:30 in Brussels (Summer)
checkTime("2026-06-27T05:00:00Z"); // 7:00 in Brussels (Summer) -> EXPECT TRUE
checkTime("2026-06-27T05:59:00Z"); // 7:59 in Brussels (Summer) -> EXPECT TRUE
checkTime("2026-06-27T06:00:00Z"); // 8:00 in Brussels (Summer)
