import asyncio
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Dict, Any
from app.services.chat_service import chat

router = APIRouter()

MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_ENTRIES = 20


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=MAX_MESSAGE_LENGTH)
    history: List[Dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str


@router.post("/", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest) -> ChatResponse:
    # Trim history before forwarding so chat_service never receives unbounded input
    trimmed_history = req.history[-MAX_HISTORY_ENTRIES:]
    # Run the blocking LLM call in a thread pool to avoid blocking the event loop
    loop = asyncio.get_running_loop()
    answer = await loop.run_in_executor(None, chat, req.message, trimmed_history)
    return ChatResponse(answer=answer)
