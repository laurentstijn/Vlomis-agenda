"use client";

import { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import {
  ChevronLeft,
  ChevronRight,
  Ship,
  User,
  Calendar,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Settings,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LoginDialog } from "./login-dialog";
import { SyncSettingsDialog } from "./sync-settings-dialog";
import { authStore, AuthCredentials } from "@/lib/auth-store";

interface PlanningEntry {
  id: string;
  date: string;
  registratiesoort: string;
  van: string;
  tot: string;
  medewerker: string;
  functie: string;
  afdeling: string;
  vaartuig: string;
}

interface PlanningItem {
  dag: string;
  dienst: string;
  functie: string;
  vaartuig: string;
  van: Date;
  tot: Date;
  registratiesoort: string;
}

const fetcher = ([url, username, password]: [string, string?, string?]) => {
  const params = new URLSearchParams();
  if (username) params.set("username", username);
  if (password) params.set("password", password);

  const queryString = params.toString();
  const finalUrl = queryString ? `${url}?${queryString}` : url;

  return fetch(finalUrl).then((res) => res.json());
};

const WEEKDAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const MONTHS = [
  "Januari",
  "Februari",
  "Maart",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Augustus",
  "September",
  "Oktober",
  "November",
  "December",
];

const registratieColors: Record<
  string,
  { bg: string; text: string; border: string; label: string }
> = {
  Dagdienst: {
    bg: "bg-emerald-100",
    text: "text-emerald-800",
    border: "border-emerald-300",
    label: "Dagdienst",
  },
  "Dagdienst kantooruren": {
    bg: "bg-teal-100",
    text: "text-teal-800",
    border: "border-teal-300",
    label: "Kantoor",
  },
  Reserve: {
    bg: "bg-amber-100",
    text: "text-amber-800",
    border: "border-amber-300",
    label: "Reserve",
  },
  "Rust - Binnenbeurt": {
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-300",
    label: "Rust",
  },
  Ziekte: {
    bg: "bg-red-100",
    text: "text-red-800",
    border: "border-red-300",
    label: "Ziekte",
  },
  Verlof: {
    bg: "bg-sky-100",
    text: "text-sky-800",
    border: "border-sky-300",
    label: "Verlof",
  },
  "Vorming (dienstvrijstelling)": {
    bg: "bg-indigo-100",
    text: "text-indigo-800",
    border: "border-indigo-300",
    label: "Vorming",
  },
};

function getColorForType(type: string) {
  if (registratieColors[type]) return registratieColors[type];

  if (type.includes('Verlof') && type.includes('Aangevraagd')) {
    return {
      bg: "bg-sky-50",
      text: "text-sky-600",
      border: "border-sky-200 border-dashed",
      label: "Verlof (Aanvraag)",
    };
  }

  const knownKeys = Object.keys(registratieColors);
  const match = knownKeys.find(key => type.startsWith(key) || type.includes(key));

  if (match) return registratieColors[match];

  return {
    bg: "bg-gray-100",
    text: "text-gray-800",
    border: "border-gray-300",
    label: type,
  };
}

function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function parseApiDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes("-") && dateStr.includes("T")) {
    return new Date(dateStr);
  }
  const normalized = dateStr.replace(/\s+/g, " ").trim();
  const [datePart, timePart] = normalized.split(" ");
  if (!datePart) return new Date();
  const [day, month, year] = datePart.split("/").map(Number);
  const [hours, minutes] = (timePart || "00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

function convertApiDataToPlanning(entries: PlanningEntry[]): PlanningItem[] {
  return entries.map((entry) => ({
    dag: "",
    dienst: entry.afdeling || "",
    functie: entry.functie || "",
    vaartuig: entry.vaartuig || "",
    van: parseApiDate(entry.van),
    tot: parseApiDate(entry.tot),
    registratiesoort: entry.registratiesoort || "",
  }));
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function getStartDayOfWeek(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function PlanningCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [creds, setCreds] = useState<AuthCredentials | null>(null);
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const saved = authStore.getCredentials();
    if (saved) {
      setCreds(saved);
    } else {
      setIsLoginDialogOpen(true);
    }

    if (searchParams.get("google_connected") === "true") {
      toast.success("Google Agenda succesvol gekoppeld!", {
        description: "Je planning wordt nu gesynchroniseerd.",
      });
      mutate();
      router.replace("/");
    }
  }, [searchParams, router]);

  const handleDisconnect = async () => {
    if (!data?.userId) return;
    try {
      const res = await fetch('/api/auth/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.userId }),
      });
      if (res.ok) {
        toast.success("Google Agenda ontkoppeld.");
        mutate();
      } else {
        toast.error("Kon agenda niet ontkoppelen.");
      }
    } catch (error) {
      toast.error("Er is een fout opgetreden.");
    }
  };

  const handleLoginSuccess = (username: string, password: string) => {
    setCreds({ username, password });
    setIsLoginDialogOpen(false);
  };

  const handleLogout = () => {
    authStore.clearCredentials();
    setCreds(null);
    setIsLoginDialogOpen(true);
    setIsSettingsOpen(false);
  };

  const fetcher = ([url, username, password]: [string, string?, string?]) => {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then((res) => res.json());
  };

  const { data, error, isLoading, mutate } = useSWR(
    creds ? ["/api/vlomis", creds.username, creds.password] : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 0,
    }
  );

  const handleRefresh = async () => {
    if (!creds) return;
    toast.promise(
      (async () => {
        const res = await fetch(`/api/vlomis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: creds.username,
            password: creds.password,
            force: true
          })
        });
        const result = await res.json();

        if (!result.success) {
          throw new Error(result.error || "Sync mislukt");
        }

        // If scrape failed (e.g., 429) but we got cached data
        if (result.scrapeError) {
          toast.info("Vlomis is momenteel druk. Je ziet de meest recente gegevens uit de database.", {
            description: result.scrapeError,
            duration: 5000,
          });
        }

        mutate(result, false);
        return result;
      })(),
      {
        loading: "Planning vernieuwen...",
        success: "Planning succesvol gecontroleerd!",
        error: (err: any) => `Vernieuwen mislukt: ${err.message}`,
      }
    );
  };

  const planningData = useMemo(() => {
    if (data?.success && data?.data?.length > 0) {
      return convertApiDataToPlanning(data.data);
    }
    return [];
  }, [data]);

  const isUsingLiveData = data?.success && data?.data?.length > 0;
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startDay = getStartDayOfWeek(daysInMonth[0]);

  const getItemsForDay = (day: Date): PlanningItem[] => {
    return planningData.filter((item) => isSameDay(item.van, day));
  };

  const monthStats = useMemo(() => {
    const stats: Record<string, number> = {};
    planningData.forEach((item) => {
      if (item.van.getMonth() === currentMonth && item.van.getFullYear() === currentYear) {
        stats[item.registratiesoort] = (stats[item.registratiesoort] || 0) + 1;
      }
    });
    return stats;
  }, [planningData, currentMonth, currentYear]);

  const prevMonth = () => setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  const emptyCells = Array.from({ length: startDay }, (_, i) => i);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-2 md:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <Card className="mb-6 border-none shadow-sm overflow-hidden">
            <CardHeader className="p-3 md:p-6 pb-2 md:pb-4 space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 md:h-12 md:w-12 items-center justify-center rounded-xl bg-primary shrink-0">
                    <Ship className="h-5 w-5 md:h-6 md:w-6 text-primary-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-xl md:text-2xl font-bold text-foreground truncate">
                      Personeelsplanning
                    </CardTitle>
                    <p className="text-[10px] md:text-sm text-muted-foreground uppercase truncate">
                      {data?.userFunction || data?.userDepartment || (isLoading ? "Laden..." : "-")}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isLoading ? (
                    <Badge variant="secondary" className="gap-1 text-[10px] md:text-xs h-8">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Data laden...
                    </Badge>
                  ) : error ? (
                    <Badge variant="destructive" className="gap-1 text-[10px] md:text-xs h-8">
                      <AlertCircle className="h-3 w-3" />
                      Fout
                    </Badge>
                  ) : isUsingLiveData ? (
                    <Badge className="gap-1 bg-emerald-500 text-white text-[10px] md:text-xs h-8">
                      Live data
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 text-[10px] md:text-xs h-8">
                      Lokale data
                    </Badge>
                  )}

                  {data?.lastSyncAt && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="gap-1 text-[10px] md:text-xs h-8 border-primary/20 bg-primary/5 text-primary">
                          <RefreshCw className="h-3 w-3" />
                          Auto-sync: {new Date(data.lastSyncAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Laatste tijdstip dat de agenda op de achtergrond is bijgewerkt: {new Date(data.lastSyncAt).toLocaleString('nl-BE')}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isLoading || !creds}
                    className="h-8 md:h-9 px-2 md:px-4"
                  >
                    <RefreshCw className={`mr-1 h-3 w-3 md:h-4 md:w-4 ${isLoading ? "animate-spin" : ""}`} />
                    <span className="text-xs">Vernieuwen</span>
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-2 border-t">
                {creds ? (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-xs font-semibold truncate leading-none mb-1">{data?.user || creds?.username || "Gebruiker"}</span>
                      <div className="flex items-center gap-2">
                        {data?.googleConnected ? (
                          <Badge variant="outline" className="h-4 gap-0.5 border-emerald-200 bg-emerald-50 px-1 text-[8px] text-emerald-700 hover:bg-emerald-50 cursor-pointer" onClick={handleDisconnect}>
                            <CheckCircle2 className="h-2 w-2" />
                            Gekoppeld
                          </Badge>
                        ) : (
                          <button
                            className="text-[10px] text-primary hover:underline"
                            onClick={() => data?.userId && (window.location.href = `/api/auth/google/login?userId=${data.userId}`)}
                          >
                            Koppel Google
                          </button>
                        )}
                        <button onClick={handleLogout} className="text-[10px] text-muted-foreground hover:text-destructive underline">
                          Log uit
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-xs text-muted-foreground italic">Meld je aan om je planning te zien</span>
                  </div>
                )}

                <div className="flex items-center justify-between sm:justify-end gap-2">
                  <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
                    <Button variant="ghost" size="sm" onClick={prevMonth} className="h-7 w-7 md:h-8 md:w-8 p-0">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[80px] md:min-w-[120px] text-center font-semibold text-[11px] md:text-sm">
                      {MONTHS[currentMonth]} {currentYear}
                    </span>
                    <Button variant="ghost" size="sm" onClick={nextMonth} className="h-7 w-7 md:h-8 md:w-8 p-0">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={goToToday} className="h-8 md:h-9">
                      <Calendar className="mr-0 md:mr-2 h-3 w-3 md:h-4 md:w-4" />
                      <span className="hidden md:inline">Vandaag</span>
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 md:h-9 md:w-9 rounded-full bg-muted/50"
                      onClick={() => setIsSettingsOpen(true)}
                    >
                      <Settings className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Legend */}
          <Card className="mb-6 border-none shadow-sm hidden md:block">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">Legenda:</span>
                {Object.entries(registratieColors).map(([key, value]) => (
                  <div key={key} className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${value.bg} ${value.text} border ${value.border}`}>
                    <span className="text-xs font-medium">{value.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Calendar Grid */}
          <Card className="mb-6 border-none shadow-sm overflow-hidden">
            <CardContent className="p-1 md:p-4">
              <div className="mb-2 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-1 md:py-2 text-center text-[10px] md:text-sm font-semibold text-muted-foreground uppercase">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {emptyCells.map((i) => (
                  <div key={`empty-${i}`} className="min-h-[50px] md:min-h-[100px] bg-muted/5 rounded-lg" />
                ))}

                {daysInMonth.map((day) => {
                  const items = getItemsForDay(day);
                  const isToday = isSameDay(day, new Date());
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                  return (
                    <div
                      key={day.toISOString()}
                      className={`min-h-[60px] md:min-h-[100px] rounded-lg border p-1 md:p-1.5 transition-all flex flex-col ${isToday ? "border-primary bg-primary/5 ring-1 ring-primary" :
                        isWeekend ? "border-border/50 bg-muted/30" : "border-border/50 bg-card"
                        }`}
                    >
                      <div className={`mb-1 text-right text-[10px] md:text-sm font-medium ${isToday ? "text-primary font-bold" : isWeekend ? "text-muted-foreground" : "text-foreground"}`}>
                        {day.getDate()}
                      </div>

                      <div className="flex flex-col gap-0.5 md:gap-1 overflow-hidden">
                        {items.map((item, idx) => {
                          const colors = getColorForType(item.registratiesoort);
                          const showTime = item.van.getHours() !== 0 || item.van.getMinutes() !== 0;

                          return (
                            <Tooltip key={idx}>
                              <TooltipTrigger asChild>
                                <div className={`cursor-pointer rounded px-1 md:px-1.5 py-0.5 md:py-1 text-[8px] md:text-xs font-medium transition-all hover:scale-[1.02] hover:shadow-sm ${colors.bg} ${colors.text} border ${colors.border} truncate`}>
                                  <div className="truncate shrink-0">{colors.label}</div>
                                  {showTime && (
                                    <div className="text-[7px] md:text-[10px] opacity-75 hidden sm:block">
                                      {formatTime(item.van)}
                                      <span className="hidden md:inline"> - {formatTime(item.tot)}</span>
                                    </div>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[250px]">
                                <div className="space-y-1">
                                  <p className="font-semibold">{item.registratiesoort}</p>
                                  <p className="text-xs text-muted-foreground">{formatTime(item.van)} - {formatTime(item.tot)}</p>
                                  {item.vaartuig && <p className="text-xs">Vaartuig: {item.vaartuig}</p>}
                                  {item.dienst && <p className="text-xs">Dienst: {item.dienst}</p>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Monthly summary */}
          <Card className="border-none shadow-sm mb-8 overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base md:text-lg">
                Overzicht {MONTHS[currentMonth]}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                {Object.entries(monthStats).map(([type, count]) => {
                  const colors = getColorForType(type);
                  return (
                    <div key={type} className={`rounded-lg border p-2 md:p-3 ${colors.bg} ${colors.border}`}>
                      <div className={`text-xl md:text-2xl font-bold ${colors.text}`}>{count}</div>
                      <div className={`text-[10px] md:text-xs font-medium ${colors.text}`}>{colors.label}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {data?.fetchedAt && (
            <div className="mt-4 pb-8 text-center space-y-1">
              <p className="text-[10px] md:text-xs text-muted-foreground">
                Laatst bijgewerkt: {new Date(data.fetchedAt).toLocaleString("nl-BE")}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground opacity-60">
                Historie wordt tot 1 jaar bewaard.
              </p>
            </div>
          )}
        </div>
      </div>

      <LoginDialog isOpen={isLoginDialogOpen} onLoginSuccess={handleLoginSuccess} />

      {creds && (
        <SyncSettingsDialog
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          username={creds.username}
          onLogout={handleLogout}
        />
      )}
    </TooltipProvider>
  );
}
