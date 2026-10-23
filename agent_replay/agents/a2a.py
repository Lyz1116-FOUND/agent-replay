"""Internal agent-to-agent messages.

This is the A2A-shaped abstraction the harness uses *before* any external
protocol: sender, receiver, type, payload. It makes roles explicit and
loggable without pretending a wire protocol is implemented.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..harness.events import utc_now


@dataclass
class AgentMessage:
    sender: str
    receiver: str
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sender": self.sender,
            "receiver": self.receiver,
            "type": self.type,
            "payload": self.payload,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentMessage":
        return cls(
            sender=str(data["sender"]),
            receiver=str(data["receiver"]),
            type=str(data["type"]),
            payload=dict(data.get("payload", {}) or {}),
            created_at=str(data.get("created_at") or utc_now()),
        )


class MessageBus:
    def __init__(self) -> None:
        self.messages: list[AgentMessage] = []

    def send(self, message: AgentMessage) -> None:
        self.messages.append(message)

    def record(self, message: AgentMessage) -> None:
        self.send(message)

    def by_receiver(self, receiver: str) -> list[AgentMessage]:
        return [message for message in self.messages if message.receiver == receiver]

    def to_list(self) -> list[dict[str, Any]]:
        return [message.to_dict() for message in self.messages]
