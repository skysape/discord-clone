package com.example.discordclone.controller;

import com.example.discordclone.model.FriendStatus;
import com.example.discordclone.model.Message;
import com.example.discordclone.model.User;
import com.example.discordclone.repository.FriendshipRepository;
import com.example.discordclone.repository.GroupMemberRepository;
import com.example.discordclone.repository.MessageRepository;
import com.example.discordclone.repository.UserRepository;
import com.example.discordclone.security.CurrentUserHolder;
import com.example.discordclone.websocket.RealtimeHub;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

    private final MessageRepository messageRepository;
    private final UserRepository userRepository;
    private final FriendshipRepository friendshipRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final RealtimeHub hub;

    public MessageController(MessageRepository messageRepository, UserRepository userRepository,
                              FriendshipRepository friendshipRepository, GroupMemberRepository groupMemberRepository,
                              RealtimeHub hub) {
        this.messageRepository = messageRepository;
        this.userRepository = userRepository;
        this.friendshipRepository = friendshipRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.hub = hub;
    }

    private Long me() {
        return CurrentUserHolder.get();
    }

    public record SendMessageRequest(String content) {}

    private Map<String, Object> dto(Message m) {
        return Map.of(
                "id", m.getId(),
                "senderId", m.getSenderId(),
                "receiverId", m.getReceiverId() == null ? 0 : m.getReceiverId(),
                "groupId", m.getGroupId() == null ? 0 : m.getGroupId(),
                "content", m.getContent(),
                "createdAt", m.getCreatedAt().toEpochMilli()
        );
    }

    private boolean areFriends(Long a, Long b) {
        return friendshipRepository.findByRequesterIdAndReceiverId(a, b)
                .filter(f -> f.getStatus() == FriendStatus.ACCEPTED).isPresent()
                || friendshipRepository.findByRequesterIdAndReceiverId(b, a)
                .filter(f -> f.getStatus() == FriendStatus.ACCEPTED).isPresent();
    }

    // ---------- Личные сообщения ----------

    @GetMapping("/direct/{friendId}")
    public ResponseEntity<?> directHistory(@PathVariable Long friendId) {
        Long myId = me();
        if (!areFriends(myId, friendId)) {
            return ResponseEntity.status(403).body(Map.of("error", "Вы не друзья"));
        }
        List<Map<String, Object>> messages = messageRepository.findDirectMessages(myId, friendId)
                .stream().map(this::dto).toList();
        return ResponseEntity.ok(messages);
    }

    @PostMapping("/direct/{friendId}")
    public ResponseEntity<?> sendDirect(@PathVariable Long friendId, @RequestBody SendMessageRequest req) {
        Long myId = me();
        if (req.content() == null || req.content().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Пустое сообщение"));
        }
        if (!areFriends(myId, friendId)) {
            return ResponseEntity.status(403).body(Map.of("error", "Вы не друзья"));
        }
        Message m = new Message();
        m.setSenderId(myId);
        m.setReceiverId(friendId);
        m.setContent(req.content().trim());
        messageRepository.save(m);

        hub.sendTo(friendId, "new_direct_message", dto(m));

        return ResponseEntity.ok(dto(m));
    }

    // ---------- Групповые сообщения ----------

    @GetMapping("/group/{groupId}")
    public ResponseEntity<?> groupHistory(@PathVariable Long groupId) {
        Long myId = me();
        if (!groupMemberRepository.existsByGroupIdAndUserId(groupId, myId)) {
            return ResponseEntity.status(403).body(Map.of("error", "Вы не в этой группе"));
        }
        List<Map<String, Object>> messages = messageRepository.findByGroupIdOrderByCreatedAtAsc(groupId)
                .stream().map(this::dto).toList();
        return ResponseEntity.ok(messages);
    }

    @PostMapping("/group/{groupId}")
    public ResponseEntity<?> sendGroup(@PathVariable Long groupId, @RequestBody SendMessageRequest req) {
        Long myId = me();
        if (req.content() == null || req.content().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Пустое сообщение"));
        }
        if (!groupMemberRepository.existsByGroupIdAndUserId(groupId, myId)) {
            return ResponseEntity.status(403).body(Map.of("error", "Вы не в этой группе"));
        }
        Message m = new Message();
        m.setSenderId(myId);
        m.setGroupId(groupId);
        m.setContent(req.content().trim());
        messageRepository.save(m);

        List<Long> memberIds = groupMemberRepository.findByGroupId(groupId).stream()
                .map(gm -> gm.getUserId())
                .filter(id -> !id.equals(myId))
                .toList();
        hub.broadcastTo(memberIds, "new_group_message", dto(m));

        return ResponseEntity.ok(dto(m));
    }
}
