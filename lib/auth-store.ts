
export interface AuthCredentials {
    username: string;
    password?: string;
    expiresAt?: number; // Timestamp in milliseconds
}

const STORAGE_KEY = 'vlomis_auth';
const SESSION_DURATION = 4 * 60 * 60 * 1000; // 4 hours

export const authStore = {
    saveCredentials: (creds: AuthCredentials) => {
        if (typeof window !== 'undefined') {
            const dataWithExpiry = {
                ...creds,
                expiresAt: Date.now() + SESSION_DURATION
            };
            // Use sessionStorage for "logout on close" behavior
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataWithExpiry));
        }
    },

    getCredentials: (): AuthCredentials | null => {
        if (typeof window !== 'undefined') {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    const creds: AuthCredentials = JSON.parse(saved);

                    // Check if session has expired
                    if (creds.expiresAt && Date.now() > creds.expiresAt) {
                        sessionStorage.removeItem(STORAGE_KEY);
                        return null;
                    }

                    return creds;
                } catch (e) {
                    return null;
                }
            }
        }
        return null;
    },

    clearCredentials: () => {
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem(STORAGE_KEY);
        }
    }
};
