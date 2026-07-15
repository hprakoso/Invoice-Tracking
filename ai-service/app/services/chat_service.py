from functools import lru_cache
from langchain_core.prompts import PromptTemplate
from app.services.extraction_chain import get_llm

CHAT_PROMPT = PromptTemplate(
    input_variables=["context", "history", "question"],
    template="""You are an intelligent assistant for an Invoice Tracking system.
Answer questions about invoices, vendors, payments, and accounts payable.
Be concise, accurate, and helpful. Respond in the same language as the user's question (Indonesian or English).

{context}

Conversation history:
{history}

User question: {question}

Answer:"""
)

SYSTEM_CONTEXT = """You have access to an invoice tracking system with data about:
- Invoices in various statuses: PENDING_OCR, PENDING_REVIEW, PENDING_APPROVAL, APPROVED, REJECTED, PAID
- Vendors (suppliers) with their names and NPWP (tax ID)
- Approval workflows with Finance and Manager steps
- Due dates and payment amounts in IDR (Indonesian Rupiah)

Common Indonesian invoice terms:
- "Jatuh tempo" = due date
- "Terlambat/Overdue" = past due date
- "Menunggu persetujuan" = pending approval
- "Disetujui" = approved
- "Faktur/Invoice" = invoice document
- "Vendor/Pemasok" = supplier/vendor"""


@lru_cache(maxsize=1)
def _cached_llm():
    """Return a module-level LLM singleton — constructed once per process."""
    return get_llm()


def chat(message: str, history: list) -> str:
    """Generate a chat response using the configured LLM."""
    try:
        llm = _cached_llm()

        # Format conversation history (last 3 exchanges)
        history_text = ""
        for entry in history[-6:]:
            role = entry.get("role", "user")
            content = entry.get("content", "")
            prefix = "User" if role == "user" else "Assistant"
            history_text += f"{prefix}: {content}\n"

        chain = CHAT_PROMPT | llm
        result = chain.invoke({
            "context": SYSTEM_CONTEXT,
            "history": history_text or "No previous conversation.",
            "question": message,
        })

        return result.content if hasattr(result, "content") else str(result)

    except Exception as e:
        print(f"Chat error: {e}")
        return (
            "Maaf, saya tidak dapat memproses pertanyaan Anda saat ini. "
            "Silakan coba lagi nanti."
        )
