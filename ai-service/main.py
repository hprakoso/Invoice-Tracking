from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.ocr import router as ocr_router
from app.api.chat import router as chat_router

app = FastAPI(title="Invoice AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ocr_router, prefix="/ocr", tags=["ocr"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])

@app.get("/health")
def health():
    return {"status": "ok"}
