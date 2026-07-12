package com.example.discordclone.controller;

import com.example.discordclone.model.User;
import com.example.discordclone.repository.UserRepository;
import com.example.discordclone.security.CurrentUserHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping("/search")
    public List<Map<String, Object>> search(@RequestParam("q") String query) {
        Long myId = CurrentUserHolder.get();
        List<User> found = userRepository.findTop20ByUsernameContainingIgnoreCaseOrNicknameContainingIgnoreCase(query, query);
        return found.stream()
                .filter(u -> !u.getId().equals(myId))
                .map(u -> Map.<String, Object>of(
                        "id", u.getId(),
                        "username", u.getUsername(),
                        "nickname", u.getNickname() == null ? u.getUsername() : u.getNickname(),
                        "avatarUrl", u.getAvatarUrl() == null ? "" : u.getAvatarUrl()
                ))
                .toList();
    }
}
