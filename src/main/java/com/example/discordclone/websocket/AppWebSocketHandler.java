package com.example.discordclone.websocket;

import com.example.discordclone.repository.GroupMemberRepository;
import com.example.discordclone.security.TokenStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Единый WebSocket-канал на пользователя: /ws/voice
 * Обрабатывает:
 *  - сигналинг WebRTC для звонков 1-на-1: offer / answer / candidate / end
 *  - сигналинг WebRTC для групповых звонков (mesh): те же типы + join_group_call / leave_group_call
 *  - через RealtimeHub этот же канал используется для пуш-уведомлений (заявки в друзья, сообщения и т.д.)
 */
@Component
public class AppWebSocketHandler extends TextWebSocketHandler {

    private final TokenStore tokenStore;
    private final RealtimeHub hub;
    private final GroupCallManager groupCallManager;
    private final GroupMemberRepository groupMemberRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final Map<String, Long> sessionToUser = new ConcurrentHashMap<>();

    public AppWebSocketHandler(TokenStore tokenStore, RealtimeHub hub, GroupCallManager groupCallManager,
                                GroupMemberRepository groupMemberRepository) {
        this.tokenStore = tokenStore;
        this.hub = hub;
        this.groupCallManager = groupCallManager;
        this.groupMemberRepository = groupMemberRepository;
    }

    private Long extractUserId(WebSocketSession session) {
        URI uri = session.getUri();
        if (uri == null) return null;
        String query = uri.getQuery();
        if (query == null) return null;
        Matcher m = Pattern.compile("token=([^&]+)").matcher(query);
        if (m.find()) {
            return tokenStore.getUserId(m.group(1));
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
        hub.register(userId, session);
        sessionToUser.put(session.getId(), userId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        Long fromUserId = sessionToUser.get(session.getId());
        if (fromUserId == null) return;

        JsonNode node = objectMapper.readTree(message.getPayload());
        String type = node.has("type") ? node.get("type").asText() : "";

        switch (type) {
            case "offer":
            case "answer":
            case "candidate":
            case "end": {
                if (!node.has("to")) return;
                long toUserId = node.get("to").asLong();
                ((ObjectNode) node).put("from", fromUserId);
                relayRaw(toUserId, node);
                break;
            }
            case "join_group_call": {
                Long groupId = node.get("groupId").asLong();
                if (!groupMemberRepository.existsByGroupIdAndUserId(groupId, fromUserId)) return;
                Set<Long> existing = groupCallManager.join(groupId, fromUserId);

                hub.sendTo(fromUserId, "group_call_joined", Map.of("groupId", groupId, "participants", existing));
                for (Long participantId : existing) {
                    hub.sendTo(participantId, "group_call_peer_joined", Map.of("groupId", groupId, "userId", fromUserId));
                }
                break;
            }
            case "leave_group_call": {
                Long groupId = node.get("groupId").asLong();
                Set<Long> remaining = groupCallManager.leave(groupId, fromUserId);
                for (Long participantId : remaining) {
                    hub.sendTo(participantId, "group_call_peer_left", Map.of("groupId", groupId, "userId", fromUserId));
                }
                break;
            }
            default:
                // неизвестный тип сообщения — игнорируем
        }
    }

    /**
     * Пересылает "сырое" сообщение как есть (со всеми полями, включая groupId, sdp и т.д.),
     * это нужно для offer/answer/candidate/end, где структура payload разная для
     * звонков 1-на-1 и групповых.
     */
    private void relayRaw(long toUserId, JsonNode node) {
        WebSocketSession target = hub.getSession(toUserId);
        if (target == null || !target.isOpen()) return;
        try {
            target.sendMessage(new TextMessage(node.toString()));
        } catch (IOException ignored) {
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Long userId = sessionToUser.remove(session.getId());
        if (userId != null) {
            hub.unregister(userId, session);
            Map<Long, Set<Long>> affected = groupCallManager.leaveAll(userId);
            for (Map.Entry<Long, Set<Long>> e : affected.entrySet()) {
                for (Long participantId : e.getValue()) {
                    hub.sendTo(participantId, "group_call_peer_left", Map.of("groupId", e.getKey(), "userId", userId));
                }
            }
        }
    }
}
