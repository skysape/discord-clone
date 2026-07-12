package com.example.discordclone.controller;

import com.example.discordclone.model.FriendStatus;
import com.example.discordclone.model.Friendship;
import com.example.discordclone.model.User;
import com.example.discordclone.repository.FriendshipRepository;
import com.example.discordclone.repository.UserRepository;
import com.example.discordclone.security.CurrentUserHolder;
import com.example.discordclone.websocket.RealtimeHub;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/friends")
public class FriendController {

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;
    private final RealtimeHub hub;

    public FriendController(FriendshipRepository friendshipRepository, UserRepository userRepository, RealtimeHub hub) {
        this.friendshipRepository = friendshipRepository;
        this.userRepository = userRepository;
        this.hub = hub;
    }

    private Long me() {
        return CurrentUserHolder.get();
    }

    private Map<String, Object> userDto(User u) {
        return Map.of(
                "id", u.getId(),
                "username", u.getUsername(),
                "nickname", u.getNickname() == null ? u.getUsername() : u.getNickname(),
                "avatarUrl", u.getAvatarUrl() == null ? "" : u.getAvatarUrl()
        );
    }

    @PostMapping("/request/{username}")
    public ResponseEntity<?> sendRequest(@PathVariable String username) {
        Long myId = me();
        Optional<User> targetOpt = userRepository.findByUsername(username);
        if (targetOpt.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Пользователь не найден"));
        }
        User target = targetOpt.get();
        if (target.getId().equals(myId)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Нельзя добавить себя"));
        }
        if (friendshipRepository.findByRequesterIdAndReceiverId(myId, target.getId()).isPresent()
                || friendshipRepository.findByRequesterIdAndReceiverId(target.getId(), myId).isPresent()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Заявка уже существует или вы уже друзья"));
        }
        Friendship f = new Friendship();
        f.setRequesterId(myId);
        f.setReceiverId(target.getId());
        f.setStatus(FriendStatus.PENDING);
        friendshipRepository.save(f);

        User requesterUser = userRepository.findById(myId).orElse(null);
        if (requesterUser != null) {
            hub.sendTo(target.getId(), "friend_request", Map.of(
                    "requestId", f.getId(),
                    "userId", requesterUser.getId(),
                    "username", requesterUser.getUsername(),
                    "nickname", requesterUser.getNickname() == null ? requesterUser.getUsername() : requesterUser.getNickname(),
                    "avatarUrl", requesterUser.getAvatarUrl() == null ? "" : requesterUser.getAvatarUrl()
            ));
        }

        return ResponseEntity.ok(Map.of("status", "sent"));
    }

    @GetMapping("/requests")
    public List<Map<String, Object>> incomingRequests() {
        Long myId = me();
        return friendshipRepository.findByReceiverIdAndStatus(myId, FriendStatus.PENDING).stream()
                .map(f -> {
                    User u = userRepository.findById(f.getRequesterId()).orElse(null);
                    return Map.<String, Object>of(
                            "requestId", f.getId(),
                            "userId", u == null ? -1 : u.getId(),
                            "username", u == null ? "?" : u.getUsername(),
                            "nickname", u == null ? "?" : (u.getNickname() == null ? u.getUsername() : u.getNickname()),
                            "avatarUrl", u == null || u.getAvatarUrl() == null ? "" : u.getAvatarUrl()
                    );
                }).toList();
    }

    @PostMapping("/accept/{requestId}")
    public ResponseEntity<?> accept(@PathVariable Long requestId) {
        Long myId = me();
        Optional<Friendship> fOpt = friendshipRepository.findById(requestId);
        if (fOpt.isEmpty() || !fOpt.get().getReceiverId().equals(myId)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Заявка не найдена"));
        }
        Friendship f = fOpt.get();
        f.setStatus(FriendStatus.ACCEPTED);
        friendshipRepository.save(f);

        User accepter = userRepository.findById(myId).orElse(null);
        if (accepter != null) {
            hub.sendTo(f.getRequesterId(), "friend_accepted", Map.of("friend", userDto(accepter)));
        }

        return ResponseEntity.ok(Map.of("status", "accepted"));
    }

    @PostMapping("/decline/{requestId}")
    public ResponseEntity<?> decline(@PathVariable Long requestId) {
        Long myId = me();
        Optional<Friendship> fOpt = friendshipRepository.findById(requestId);
        if (fOpt.isEmpty() || !fOpt.get().getReceiverId().equals(myId)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Заявка не найдена"));
        }
        friendshipRepository.deleteById(requestId);
        return ResponseEntity.ok(Map.of("status", "declined"));
    }

    @GetMapping
    public List<Map<String, Object>> friends() {
        Long myId = me();
        List<Friendship> accepted = friendshipRepository.findByRequesterIdAndStatusOrReceiverIdAndStatus(
                myId, FriendStatus.ACCEPTED, myId, FriendStatus.ACCEPTED);

        return accepted.stream().map(f -> {
            Long friendId = f.getRequesterId().equals(myId) ? f.getReceiverId() : f.getRequesterId();
            User u = userRepository.findById(friendId).orElse(null);
            return Map.<String, Object>of(
                    "id", u == null ? -1 : u.getId(),
                    "username", u == null ? "?" : u.getUsername(),
                    "nickname", u == null ? "?" : (u.getNickname() == null ? u.getUsername() : u.getNickname()),
                    "avatarUrl", u == null || u.getAvatarUrl() == null ? "" : u.getAvatarUrl(),
                    "online", u != null && hub.isOnline(u.getId())
            );
        }).toList();
    }

    @DeleteMapping("/{friendId}")
    public ResponseEntity<?> remove(@PathVariable Long friendId) {
        Long myId = me();
        friendshipRepository.findByRequesterIdAndReceiverId(myId, friendId).ifPresent(friendshipRepository::delete);
        friendshipRepository.findByRequesterIdAndReceiverId(friendId, myId).ifPresent(friendshipRepository::delete);
        return ResponseEntity.ok(Map.of("status", "removed"));
    }
}
