package com.example.discordclone.model;

import jakarta.persistence.*;

@Entity
@Table(name = "friendships")
public class Friendship {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // кто отправил заявку в друзья
    @Column(nullable = false)
    private Long requesterId;

    // кому отправлена заявка
    @Column(nullable = false)
    private Long receiverId;

    @Enumerated(EnumType.STRING)
    private FriendStatus status = FriendStatus.PENDING;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getRequesterId() { return requesterId; }
    public void setRequesterId(Long requesterId) { this.requesterId = requesterId; }

    public Long getReceiverId() { return receiverId; }
    public void setReceiverId(Long receiverId) { this.receiverId = receiverId; }

    public FriendStatus getStatus() { return status; }
    public void setStatus(FriendStatus status) { this.status = status; }
}
