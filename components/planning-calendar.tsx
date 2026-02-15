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
  // Check exact match first
  if (registratieColors[type]) return registratieColors[type];

  // Check valid substrings
  if (type.includes('Verlof') && type.includes('Aangevraagd')) {
    return {
      bg: "bg-sky-50", // Lighter
      text: "text-sky-600",
      border: "border-sky-200 border-dashed", // Dashed border for pending
      label: "Verlof (Aanvraag)",
    };
  }

  // Fallback for compound types like "Dagdienst - Schip" if any
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
  const normalized = dateStr.replace(/\s+/g, " ").trim();
  const [datePart, timePart] = normalized.split(" ");
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

  // Load credentials on mount
  useEffect(() => {
    const saved = authStore.getCredentials();
    if (saved) {
      setCreds(saved);
    } else {
      setIsLoginDialogOpen(true);
    }

    if (searchParams.get("google_connected") === "true") {
      toast.success("Google Agenda succesvol gekoppeld!", {
        description: "Je planning wordt nu op de achtergrond gesynchroniseerd.",
      });
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
        mutate(); // Refresh the data to update UI
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
  };

  const { data, error, isLoading, mutate } = useSWR(
    creds ? ["/api/vlomis", creds.username, creds.password] : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 0,
    }
  );

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
      if (
        item.van.getMonth() === currentMonth &&
        item.van.getFullYear() === currentYear
      ) {
        stats[item.registratiesoort] = (stats[item.registratiesoort] || 0) + 1;
      }
    });
    return stats;
  }, [planningData, currentMonth, currentYear]);

  const prevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const emptyCells = Array.from({ length: startDay }, (_, i) => i);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <Card className="mb-6 border-none shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
                    <Ship className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl font-bold text-foreground">
                      Personeelsplanning
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Betonning Antwerpen - Zeeschelde
                    </p>
                  </div>
                </div>

                {/* Data status indicator */}
                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <Badge variant="secondary" className="gap-1">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Data laden...
                    </Badge>
                  ) : error ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Fout bij ophalen
                    </Badge>
                  ) : isUsingLiveData ? (
                    <Badge className="gap-1 bg-emerald-500 text-white">
                      Live data
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      Lokale data
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => mutate()}
                    disabled={isLoading || !creds}
                  >
                    <RefreshCw
                      className={`mr-1 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                    />
                    Vernieuwen
                  </Button>
                </div>

                <div className="flex items-center gap-4">
                  {creds && (
                    <div className="flex items-center gap-2">
                      <div className="hidden flex-col items-end md:flex">
                        <span className="text-xs font-semibold">{data?.user || creds.username}</span>

                        <div className="flex items-center gap-2">
                          {data?.googleConnected ? (
                            <Badge variant="outline" className="h-5 gap-1 border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50 cursor-pointer" onClick={handleDisconnect}>
                              <CheckCircle2 className="h-3 w-3" />
                              Agenda gekoppeld (klik om te ontkoppelen)
                            </Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-5 px-2 text-[10px]"
                              onClick={() => {
                                if (data?.userId) {
                                  window.location.href = `/api/auth/google/login?userId=${data.userId}`;
                                } else {
                                  toast.error("Gebruikers-ID niet gevonden. Probeer opnieuw in te loggen.");
                                }
                              }}
                            >
                              <Calendar className="mr-1 h-3 w-3" />
                              Koppel Google Agenda
                            </Button>
                          )}

                          <button
                            onClick={handleLogout}
                            className="text-[10px] text-muted-foreground hover:text-destructive underline"
                          >
                            Uitloggen
                          </button>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => setIsSettingsOpen(true)}
                        title="Instellingen"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground" />
                      </Button>

                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <User className="h-4 w-4" />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={prevMonth}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[140px] text-center font-semibold">
                      {MONTHS[currentMonth]} {currentYear}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={nextMonth}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" onClick={goToToday}>
                    <Calendar className="mr-2 h-4 w-4" />
                    Vandaag
                  </Button>
                </div>
              </div>

              {/* Employee info */}
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-4 py-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Hoofdschipper (functie gezagvoerder)
                </span>
              </div>
            </CardHeader>
          </Card>

          {/* Legend */}
          <Card className="mb-6 border-none shadow-sm">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Legenda:
                </span>
                {Object.entries(registratieColors).map(([key, value]) => (
                  <div
                    key={key}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${value.bg} ${value.text} border ${value.border}`}
                  >
                    <span className="text-xs font-medium">{value.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Calendar Grid */}
          <Card className="mb-6 border-none shadow-sm">
            <CardContent className="p-4">
              {/* Weekday headers */}
              <div className="mb-2 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <div
                    key={day}
                    className="py-2 text-center text-sm font-semibold text-muted-foreground"
                  >
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar days */}
              <div className="grid grid-cols-7 gap-1">
                {/* Empty cells for days before the 1st */}
                {emptyCells.map((i) => (
                  <div key={`empty-${i}`} className="min-h-[100px]" />
                ))}

                {/* Actual days */}
                {daysInMonth.map((day) => {
                  const items = getItemsForDay(day);
                  const isToday = isSameDay(day, new Date());
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                  return (
                    <div
                      key={day.toISOString()}
                      className={`min-h-[100px] rounded-lg border p-1.5 transition-all ${isToday
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : isWeekend
                          ? "border-border/50 bg-muted/30"
                          : "border-border/50 bg-card"
                        }`}
                    >
                      <div
                        className={`mb-1 text-right text-sm font-medium ${isToday
                          ? "text-primary"
                          : isWeekend
                            ? "text-muted-foreground"
                            : "text-foreground"
                          }`}
                      >
                        {day.getDate()}
                      </div>

                      <div className="flex flex-col gap-1">
                        {items.map((item, idx) => {
                          const colors = getColorForType(item.registratiesoort);
                          const showTime =
                            item.van.getHours() !== 0 ||
                            item.van.getMinutes() !== 0;

                          return (
                            <Tooltip key={idx}>
                              <TooltipTrigger asChild>
                                <div
                                  className={`cursor-pointer rounded px-1.5 py-1 text-xs font-medium transition-all hover:scale-[1.02] hover:shadow-sm ${colors.bg} ${colors.text} border ${colors.border}`}
                                >
                                  <div className="truncate">{colors.label}</div>
                                  {showTime && (
                                    <div className="mt-0.5 text-[10px] opacity-75">
                                      {formatTime(item.van)} -{" "}
                                      {formatTime(item.tot)}
                                    </div>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="right"
                                className="max-w-[250px]"
                              >
                                <div className="space-y-1">
                                  <p className="font-semibold">
                                    {item.registratiesoort}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatTime(item.van)} -{" "}
                                    {formatTime(item.tot)}
                                  </p>
                                  {item.vaartuig && (
                                    <p className="text-xs">
                                      Vaartuig: {item.vaartuig}
                                    </p>
                                  )}
                                  {item.dienst && (
                                    <p className="text-xs">
                                      Dienst: {item.dienst}
                                    </p>
                                  )}
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
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">
                Overzicht {MONTHS[currentMonth]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                {Object.entries(monthStats).map(([type, count]) => {
                  const colors = getColorForType(type);
                  return (
                    <div
                      key={type}
                      className={`rounded-lg border p-3 ${colors.bg} ${colors.border}`}
                    >
                      <div className={`text-2xl font-bold ${colors.text}`}>
                        {count}
                      </div>
                      <div className={`text-xs font-medium ${colors.text}`}>
                        {colors.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Last updated info */}
          {data?.fetchedAt && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Laatst bijgewerkt:{" "}
              {new Date(data.fetchedAt).toLocaleString("nl-BE")}
            </p>
          )}
        </div>
      </div>
      <LoginDialog
        isOpen={isLoginDialogOpen}
        onLoginSuccess={handleLoginSuccess}
      />

      {creds && (
        <SyncSettingsDialog
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          username={creds.username}
        />
      )}
    </TooltipProvider>
  );
}
