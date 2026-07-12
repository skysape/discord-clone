package com.example.discordclone.repository;

import com.example.discordclone.model.Message;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MessageRepository extends JpaRepository<Message, Long> {

    @Query("SELECT m FROM Message m WHERE (m.senderId = :a AND m.receiverId = :b) OR (m.senderId = :b AND m.receiverId = :a) ORDER BY m.createdAt ASC")
    List<Message> findDirectMessages(@Param("a") Long userA, @Param("b") Long userB);

    List<Message> findByGroupIdOrderByCreatedAtAsc(Long groupId);
}
