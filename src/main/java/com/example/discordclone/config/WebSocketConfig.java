package com.example.discordclone.config;

import com.example.discordclone.websocket.VoiceSignalingHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final VoiceSignalingHandler voiceSignalingHandler;

    public WebSocketConfig(VoiceSignalingHandler voiceSignalingHandler) {
        this.voiceSignalingHandler = voiceSignalingHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(voiceSignalingHandler, "/ws/voice").setAllowedOriginPatterns("*");
    }
}
