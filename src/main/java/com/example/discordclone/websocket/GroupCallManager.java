package com.example.discordclone.websocket;

import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory состояние активных групповых звонков: groupId -> множество userId участников.
 */
@Component
public class GroupCallManager {

    private final Map<Long, Set<Long>> groupParticipants = new ConcurrentHashMap<>();

    /** Добавляет пользователя в звонок и возвращает список участников, которые были там ДО него. */
    public synchronized Set<Long> join(Long groupId, Long userId) {
        Set<Long> set = groupParticipants.computeIfAbsent(groupId, k -> ConcurrentHashMap.newKeySet());
        Set<Long> existing = new HashSet<>(set);
        set.add(userId);
        return existing;
    }

    /** Убирает пользователя из звонка и возвращает оставшихся участников. */
    public synchronized Set<Long> leave(Long groupId, Long userId) {
        Set<Long> set = groupParticipants.get(groupId);
        if (set == null) return Collections.emptySet();
        set.remove(userId);
        Set<Long> remaining = new HashSet<>(set);
        if (set.isEmpty()) groupParticipants.remove(groupId);
        return remaining;
    }

    /** Убирает пользователя из ВСЕХ звонков (при разрыве соединения). Возвращает groupId -> оставшиеся участники. */
    public synchronized Map<Long, Set<Long>> leaveAll(Long userId) {
        Map<Long, Set<Long>> affected = new HashMap<>();
        for (Map.Entry<Long, Set<Long>> e : groupParticipants.entrySet()) {
            if (e.getValue().remove(userId)) {
                affected.put(e.getKey(), new HashSet<>(e.getValue()));
            }
        }
        groupParticipants.values().removeIf(Set::isEmpty);
        return affected;
    }
}
