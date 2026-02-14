import { Suspense } from "react";
import { PlanningCalendar } from "@/components/planning-calendar";

// Personeelsplanning Maandkalender - Vlomis integratie
export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Laden...</div>}>
      <PlanningCalendar />
    </Suspense>
  );
}
