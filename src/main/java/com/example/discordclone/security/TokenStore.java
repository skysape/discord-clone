package com.example.discordclone.security;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Простое in-memory хранилище токенов сессий: token -> userId.
 * Для демо-проекта этого достаточно (не для продакшена!).
 */
@Component
public class TokenStore {

    private final Map<String, Long> tokenToUserId = new ConcurrentHashMap<>();

    public String createToken(Long userId) {
        String token = UUID.randomUUID().toString();
        tokenToUserId.put(token, userId);
        return token;
    }

    public Long getUserId(String token) {
        if (token == null) return null;
        return tokenToUserId.get(token);
    }

    public void invalidate(String token) {
        tokenToUserId.remove(token);
    }
}
