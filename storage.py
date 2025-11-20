from abc import ABC, abstractmethod
from typing import Any, Dict

class ContextStore(ABC):
    @abstractmethod
    def get_context(self, session_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    def save_context(self, session_id: str, context: Dict[str, Any]):
        pass

class InMemoryStore(ContextStore):
    def __init__(self):
        self._store = {}

    def get_context(self, session_id: str) -> Dict[str, Any]:
        return self._store.get(session_id, {})

    def save_context(self, session_id: str, context: Dict[str, Any]):
        self._store[session_id] = context

class RedisStore(ContextStore):
    def __init__(self, redis_url: str):
        # self.client = redis.from_url(redis_url)
        pass

    def get_context(self, session_id: str) -> Dict[str, Any]:
        # Implementar lógica de fetch e json.loads
        print("Redis: Buscando contexto...")
        return {}

    def save_context(self, session_id: str, context: Dict[str, Any]):
        # Implementar lógica de json.dumps e set
        print("Redis: Salvando contexto...")