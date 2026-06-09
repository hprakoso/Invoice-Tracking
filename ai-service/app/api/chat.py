from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Any
from app.services.chat_service import chat

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, Any]] = []


class ChatResponse(BaseModel):
    answer: str


@router.post("/", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest) -> ChatResponse:
    answer = chat(req.message, req.history)
    return ChatResponse(answer=answer)
