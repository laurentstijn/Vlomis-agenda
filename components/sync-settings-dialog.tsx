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
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Settings } from "lucide-react";
import useSWR from "swr";

interface SyncSettingsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    username: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function SyncSettingsDialog({
    isOpen,
    onClose,
    username,
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
                    sync_interval_minutes: parseInt(interval),
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
                        <Label htmlFor="interval" className="text-right">
                            Interval
                        </Label>
                        <div className="col-span-3">
                            <Select value={interval} onValueChange={setInterval} disabled={isLoading}>
                                <SelectTrigger id="interval">
                                    <SelectValue placeholder="Kies interval" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="15">Elke 15 minuten (Test)</SelectItem>
                                    <SelectItem value="30">Elke 30 minuten</SelectItem>
                                    <SelectItem value="60">Elk uur</SelectItem>
                                    <SelectItem value="120">Elke 2 uur</SelectItem>
                                    <SelectItem value="240">Elke 4 uur</SelectItem>
                                    <SelectItem value="360">Elke 6 uur</SelectItem>
                                    <SelectItem value="720">Elke 12 uur</SelectItem>
                                    <SelectItem value="1440">Elke dag (24u)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {data?.settings?.last_synced_at && (
                        <div className="text-xs text-muted-foreground text-center">
                            Laatste achtergrond sync: {new Date(data.settings.last_synced_at).toLocaleString('nl-BE')}
                        </div>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>Annuleren</Button>
                    <Button onClick={handleSave} disabled={isSaving || isLoading}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Opslaan
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
