package com.example.discordclone.security;

public class CurrentUserHolder {
    private static final ThreadLocal<Long> CURRENT_USER_ID = new ThreadLocal<>();

    public static void set(Long userId) {
        CURRENT_USER_ID.set(userId);
    }

    public static Long get() {
        return CURRENT_USER_ID.get();
    }

    public static void clear() {
        CURRENT_USER_ID.remove();
    }
}
