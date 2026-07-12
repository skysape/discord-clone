package com.example.discordclone.controller;

import com.example.discordclone.model.User;
import com.example.discordclone.repository.UserRepository;
import com.example.discordclone.security.CurrentUserHolder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {

    private final UserRepository userRepository;

    @Value("${app.upload.dir}")
    private String uploadDir;

    public ProfileController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    private User currentUser() {
        Long id = CurrentUserHolder.get();
        return userRepository.findById(id).orElseThrow();
    }

    @GetMapping("/me")
    public ResponseEntity<?> me() {
        User u = currentUser();
        return ResponseEntity.ok(Map.of(
                "id", u.getId(),
                "username", u.getUsername(),
                "nickname", u.getNickname() == null ? u.getUsername() : u.getNickname(),
                "avatarUrl", u.getAvatarUrl() == null ? "" : u.getAvatarUrl(),
                "language", u.getLanguage() == null ? "ru" : u.getLanguage()
        ));
    }

    public record NicknameRequest(String nickname) {}

    @PutMapping("/nickname")
    public ResponseEntity<?> setNickname(@RequestBody NicknameRequest req) {
        if (req.nickname() == null || req.nickname().isBlank() || req.nickname().length() > 32) {
            return ResponseEntity.badRequest().body(Map.of("error", "Некорректный никнейм"));
        }
        User u = currentUser();
        u.setNickname(req.nickname().trim());
        userRepository.save(u);
        return ResponseEntity.ok(Map.of("nickname", u.getNickname()));
    }

    public record LanguageRequest(String language) {}

    @PutMapping("/language")
    public ResponseEntity<?> setLanguage(@RequestBody LanguageRequest req) {
        if (req.language() == null || !req.language().matches("ru|be|pl|en")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Неподдерживаемый язык"));
        }
        User u = currentUser();
        u.setLanguage(req.language());
        userRepository.save(u);
        return ResponseEntity.ok(Map.of("language", u.getLanguage()));
    }

    @PostMapping("/avatar")
    public ResponseEntity<?> uploadAvatar(@RequestParam("file") MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Файл пуст"));
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Можно загружать только изображения"));
        }
        Path dir = Paths.get(uploadDir, "avatars");
        Files.createDirectories(dir);

        String ext = "";
        String original = file.getOriginalFilename();
        if (original != null && original.contains(".")) {
            ext = original.substring(original.lastIndexOf('.'));
        }
        String filename = UUID.randomUUID() + ext;
        Path target = dir.resolve(filename);
        file.transferTo(target);

        String url = "/uploads/avatars/" + filename;
        User u = currentUser();
        u.setAvatarUrl(url);
        userRepository.save(u);

        return ResponseEntity.ok(Map.of("avatarUrl", url));
    }
}
