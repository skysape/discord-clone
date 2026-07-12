package com.example.discordclone.repository;

import com.example.discordclone.model.Friendship;
import com.example.discordclone.model.FriendStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FriendshipRepository extends JpaRepository<Friendship, Long> {

    List<Friendship> findByReceiverIdAndStatus(Long receiverId, FriendStatus status);

    List<Friendship> findByRequesterIdAndStatusOrReceiverIdAndStatus(
            Long requesterId, FriendStatus status1, Long receiverId, FriendStatus status2);

    Optional<Friendship> findByRequesterIdAndReceiverId(Long requesterId, Long receiverId);
}
