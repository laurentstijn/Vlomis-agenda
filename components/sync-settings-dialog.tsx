"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import useSWR from "swr";

interface SyncSettingsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    username: string;
    onLogout?: () => void;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function SyncSettingsDialog({
    isOpen,
    onClose,
    username,
    onLogout,
}: SyncSettingsDialogProps) {
    const [interval, setInterval] = useState("60");
    const [isSaving, setIsSaving] = useState(false);

    const { data, isLoading, mutate } = useSWR(
        isOpen ? `/api/settings?username=${username}` : null,
        fetcher
    );

    useEffect(() => {
        if (data?.success && data?.settings) {
            setInterval(data.settings.sync_interval_minutes.toString());
        }
    }, [data]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username,
                    // sync_interval_minutes is now ignored/enforced by backend
                }),
            });
            const json = await res.json();

            if (json.success) {
                toast.success("Instellingen opgeslagen!");
                mutate(); // Refresh the data
                onClose();
            } else {
                toast.error(json.error || "Er ging iets mis.");
            }
        } catch (err) {
            toast.error("Kan instellingen niet opslaan.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Synchronisatie Instellingen</DialogTitle>
                    <DialogDescription>
                        Bepaal hoe vaak de agenda op de achtergrond wordt bijgewerkt.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">
                            Frequentie
                        </Label>
                        <div className="col-span-3">
                            <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                                Elke 6 uur (automatisch)
                            </div>
                        </div>
                    </div>
                    {data?.settings?.last_synced_at && (
                        <div className="text-xs text-muted-foreground text-center">
                            Laatste achtergrond sync: {new Date(data.settings.last_synced_at).toLocaleString('nl-BE')}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3 pt-2">
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={onClose}>Annuleren</Button>
                        <Button onClick={handleSave} disabled={isSaving || isLoading}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Opslaan
                        </Button>
                    </div>

                    {onLogout && (
                        <div className="pt-3 mt-1 border-t">
                            <Button
                                variant="ghost"
                                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 h-10"
                                onClick={onLogout}
                            >
                                Uitloggen
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
