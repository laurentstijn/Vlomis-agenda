"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User, Ship, AlertCircle } from "lucide-react";
import { authStore } from "@/lib/auth-store";

interface LoginDialogProps {
    isOpen: boolean;
    onLoginSuccess: (username: string, password: string) => void;
}

export function LoginDialog({ isOpen, onLoginSuccess }: LoginDialogProps) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) {
            setError("Vul zowel je gebruikersnaam als wachtwoord in.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // Test the credentials against our API
            const res = await fetch(`/api/vlomis?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
            const data = await res.json();

            if (data.success) {
                authStore.saveCredentials({ username, password });
                onLoginSuccess(username, password);
            } else {
                setError(data.error || "Inloggen mislukt. Controleer je gegevens.");
            }
        } catch (err) {
            setError("Er is een fout opgetreden bij het verbinden met de server.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <Ship className="h-6 w-6 text-primary" />
                    </div>
                    <DialogTitle className="text-center text-2xl font-bold">
                        Vlomis Inloggen
                    </DialogTitle>
                    <DialogDescription className="text-center">
                        Voer je Vlomis-gegevens in om je persoonlijke planning te bekijken en te synchroniseren.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="username">Gebruikersnaam</Label>
                        <div className="relative">
                            <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="username"
                                placeholder="vlomis_gebruiker"
                                className="pl-10"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoComplete="username"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="password">Wachtwoord</Label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                className="pl-10"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="current-password"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertCircle className="h-4 w-4" />
                            <p>{error}</p>
                        </div>
                    )}

                    <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Controleren..." : "Inloggen"}
                    </Button>
                </form>

                <DialogFooter className="sm:justify-center">
                    <p className="text-xs text-muted-foreground">
                        Je gegevens worden veilig opgeslagen om automatische synchronisatie mogelijk te maken.
                    </p>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
