
export interface AuthCredentials {
    username: string;
    password?: string;
}

const STORAGE_KEY = 'vlomis_auth';

export const authStore = {
    saveCredentials: (creds: AuthCredentials) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
        }
    },

    getCredentials: (): AuthCredentials | null => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch (e) {
                    return null;
                }
            }
        }
        return null;
    },

    clearCredentials: () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY);
        }
    }
};
