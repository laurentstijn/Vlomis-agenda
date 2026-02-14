import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended for GCM
const TAG_LENGTH = 16;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
    console.error('CRITICAL: ENCRYPTION_KEY is missing from environment variables!');
}

/**
 * Encrypts a string using AES-256-GCM
 * Output format: iv:authTag:encryptedContent (all hex)
 */
export function encrypt(text: string): string {
    if (!ENCRYPTION_KEY) return text; // Fallback to plain text if key is missing (should not happen in prod)

    const iv = crypto.randomBytes(IV_LENGTH);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with the above function
 */
export function decrypt(encryptedText: string): string {
    if (!ENCRYPTION_KEY || !encryptedText.includes(':')) return encryptedText;

    try {
        const [ivHex, authTagHex, encryptedContent] = encryptedText.split(':');

        if (!ivHex || !authTagHex || !encryptedContent) return encryptedText;

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error);
        return encryptedText; // Return original if decryption fails
    }
}
