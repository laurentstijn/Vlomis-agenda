import { supabase } from './supabase'
import { encrypt } from './encryption'

export interface User {
    id: string
    vlomis_username: string
    vlomis_password?: string
    display_name?: string
    last_sync_at?: string
    created_at?: string
}

/**
 * Find or create a user by their Vlomis username
 * In this simple implementation, the Vlomis credentials act as the login
 */
export async function getOrCreateUser(username: string, password?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
        // 1. Try to find existing user (Case-insensitive)
        const { data: existingUser, error: findError } = await supabase
            .from('users')
            .select('*')
            .ilike('vlomis_username', username)
            .single()

        if (findError && findError.code !== 'PGRST116') { // PGRST116 is code for "no rows found"
            console.error('Error finding user:', findError)
            return { success: false, error: findError.message }
        }

        if (existingUser) {
            // If password provided, update it (encrypt it)
            if (password) {
                const encryptedPassword = encrypt(password);
                if (existingUser.vlomis_password !== encryptedPassword) {
                    await supabase
                        .from('users')
                        .update({ vlomis_password: encryptedPassword })
                        .eq('id', existingUser.id)
                }
            }
            return { success: true, user: existingUser }
        }

        // 2. Create new user if not found
        if (!password) {
            return { success: false, error: 'Password required for first-time login' }
        }

        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert([{
                vlomis_username: username,
                vlomis_password: encrypt(password),
                display_name: username
            }])
            .select()
            .single()

        if (createError) {
            console.error('Error creating user:', createError)
            return { success: false, error: createError.message }
        }

        return { success: true, user: newUser }
    } catch (error: any) {
        console.error('User DB error:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Get user by ID
 */
export async function getUserById(id: string): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', id)
            .single()

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true, user: data }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}
/**
 * Hard reset a user: delete all planning entries and then delete the user itself
 */
export async function hardResetUser(username: string): Promise<{ success: boolean; error?: string }> {
    try {
        // 1. Find the user
        const { data: user, error: findError } = await supabase
            .from('users')
            .select('id')
            .eq('vlomis_username', username)
            .single();

        if (findError) return { success: false, error: findError.message };

        // 2. Delete all planning entries
        const { error: deleteEntriesError } = await supabase
            .from('planning_entries')
            .delete()
            .eq('user_id', user.id);

        if (deleteEntriesError) return { success: false, error: deleteEntriesError.message };

        // 3. Delete the user record completely
        const { error: deleteUserError } = await supabase
            .from('users')
            .delete()
            .eq('id', user.id);

        if (deleteUserError) return { success: false, error: deleteUserError.message };

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
