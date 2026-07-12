package com.example.discordclone.websocket;

import com.example.discordclone.security.TokenStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Простой сигналинг-сервер для WebRTC (голосовые звонки).
 * Пересылает offer/answer/candidate и события mute/unmute между двумя пользователями.
 * Формат сообщения (JSON): { "type": "...", "to": <userId>, "payload": {...} }
 */
@Component
public class VoiceSignalingHandler extends TextWebSocketHandler {

    private final TokenStore tokenStore;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // userId -> активная сессия
    private final Map<Long, WebSocketSession> sessions = new ConcurrentHashMap<>();
    // session.id -> userId (для очистки при отключении)
    private final Map<String, Long> sessionToUser = new ConcurrentHashMap<>();

    public VoiceSignalingHandler(TokenStore tokenStore) {
        this.tokenStore = tokenStore;
    }

    private Long extractUserId(WebSocketSession session) {
        URI uri = session.getUri();
        if (uri == null) return null;
        String query = uri.getQuery();
        if (query == null) return null;
        Pattern p = Pattern.compile("token=([^&]+)");
        Matcher m = p.matcher(query);
        if (m.find()) {
            String token = m.group(1);
            return tokenStore.getUserId(token);
        }
        return null;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        Long userId = extractUserId(session);
        if (userId == null) {
            session.close(CloseStatus.NOT_ACCEPTABLE);
            return;
        }
        sessions.put(userId, session);
        sessionToUser.put(session.getId(), userId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Long fromUserId = sessionToUser.get(session.getId());
        if (fromUserId == null) return;

        JsonNode node = objectMapper.readTree(message.getPayload());
        long toUserId = node.get("to").asLong();

        WebSocketSession targetSession = sessions.get(toUserId);
        if (targetSession != null && targetSession.isOpen()) {
            // добавляем/перезаписываем поле "from", чтобы получатель знал, кто отправитель
            ((com.fasterxml.jackson.databind.node.ObjectNode) node).put("from", fromUserId);
            targetSession.sendMessage(new TextMessage(node.toString()));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws IOException {
        Long userId = sessionToUser.remove(session.getId());
        if (userId != null) {
            sessions.remove(userId, session);
        }
    }
}
