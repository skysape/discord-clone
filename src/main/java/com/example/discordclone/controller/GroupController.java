package com.example.discordclone.controller;

import com.example.discordclone.model.Group;
import com.example.discordclone.model.GroupMember;
import com.example.discordclone.model.User;
import com.example.discordclone.repository.GroupMemberRepository;
import com.example.discordclone.repository.GroupRepository;
import com.example.discordclone.repository.UserRepository;
import com.example.discordclone.security.CurrentUserHolder;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/groups")
public class GroupController {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;

    public GroupController(GroupRepository groupRepository, GroupMemberRepository groupMemberRepository, UserRepository userRepository) {
        this.groupRepository = groupRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.userRepository = userRepository;
    }

    private Long me() {
        return CurrentUserHolder.get();
    }

    public record CreateGroupRequest(String name) {}

    @PostMapping
    public ResponseEntity<?> create(@RequestBody CreateGroupRequest req) {
        if (req.name() == null || req.name().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Введите название группы"));
        }
        Long myId = me();
        Group g = new Group();
        g.setName(req.name().trim());
        g.setOwnerId(myId);
        groupRepository.save(g);

        GroupMember owner = new GroupMember();
        owner.setGroupId(g.getId());
        owner.setUserId(myId);
        groupMemberRepository.save(owner);

        return ResponseEntity.ok(Map.of("id", g.getId(), "name", g.getName()));
    }

    @GetMapping
    public List<Map<String, Object>> myGroups() {
        Long myId = me();
        List<GroupMember> memberships = groupMemberRepository.findByUserId(myId);
        return memberships.stream()
                .map(m -> groupRepository.findById(m.getGroupId()).orElse(null))
                .filter(g -> g != null)
                .map(g -> Map.<String, Object>of("id", g.getId(), "name", g.getName(), "ownerId", g.getOwnerId()))
                .toList();
    }

    @GetMapping("/{groupId}/members")
    public ResponseEntity<?> members(@PathVariable Long groupId) {
        Long myId = me();
        if (!groupMemberRepository.existsByGroupIdAndUserId(groupId, myId)) {
            return ResponseEntity.status(403).body(Map.of("error", "Вы не состоите в этой группе"));
        }
        List<Map<String, Object>> members = groupMemberRepository.findByGroupId(groupId).stream()
                .map(gm -> userRepository.findById(gm.getUserId()).orElse(null))
                .filter(u -> u != null)
                .map(u -> Map.<String, Object>of(
                        "id", u.getId(),
                        "username", u.getUsername(),
                        "nickname", u.getNickname() == null ? u.getUsername() : u.getNickname(),
                        "avatarUrl", u.getAvatarUrl() == null ? "" : u.getAvatarUrl()
                )).toList();
        return ResponseEntity.ok(members);
    }

    @PostMapping("/{groupId}/members/{username}")
    public ResponseEntity<?> addMember(@PathVariable Long groupId, @PathVariable String username) {
        Long myId = me();
        Optional<Group> gOpt = groupRepository.findById(groupId);
        if (gOpt.isEmpty() || !groupMemberRepository.existsByGroupIdAndUserId(groupId, myId)) {
            return ResponseEntity.status(403).body(Map.of("error", "Нет доступа к группе"));
        }
        Optional<User> uOpt = userRepository.findByUsername(username);
        if (uOpt.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Пользователь не найден"));
        }
        if (groupMemberRepository.existsByGroupIdAndUserId(groupId, uOpt.get().getId())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Пользователь уже в группе"));
        }
        GroupMember gm = new GroupMember();
        gm.setGroupId(groupId);
        gm.setUserId(uOpt.get().getId());
        groupMemberRepository.save(gm);
        return ResponseEntity.ok(Map.of("status", "added"));
    }
}
