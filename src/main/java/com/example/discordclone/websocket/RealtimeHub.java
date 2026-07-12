package com.example.discordclone.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Общий реестр открытых WebSocket-соединений пользователей.
 * Используется как для сигналинга звонков, так и для мгновенных
 * пуш-уведомлений (заявки в друзья, новые сообщения и т.д.).
 */
@Component
public class RealtimeHub {

    private final Map<Long, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public void register(Long userId, WebSocketSession session) {
        sessions.put(userId, session);
    }

    public void unregister(Long userId, WebSocketSession session) {
        sessions.remove(userId, session);
    }

    public boolean isOnline(Long userId) {
        WebSocketSession s = sessions.get(userId);
        return s != null && s.isOpen();
    }

    public void sendTo(Long userId, String type, Map<String, Object> payload) {
        WebSocketSession session = sessions.get(userId);
        if (session == null || !session.isOpen()) return;
        try {
            Map<String, Object> message = Map.of("type", type, "payload", payload == null ? Map.of() : payload);
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(message)));
        } catch (Exception ignored) {
            // соединение могло закрыться между проверкой и отправкой — просто игнорируем
        }
    }

    public void broadcastTo(Collection<Long> userIds, String type, Map<String, Object> payload) {
        for (Long id : userIds) {
            sendTo(id, type, payload);
        }
    }

    public WebSocketSession getSession(Long userId) {
        return sessions.get(userId);
    }
}
