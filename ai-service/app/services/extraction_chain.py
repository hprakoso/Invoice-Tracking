import os
import json
import re
from langchain_core.prompts import PromptTemplate
from langchain_core.language_models.chat_models import BaseChatModel

def get_llm() -> BaseChatModel:
    """Return configured LLM based on LLM_PROVIDER env var."""
    provider = os.getenv("LLM_PROVIDER", "groq").lower()

    if provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(
            model="llama-3.1-8b-instant",
            temperature=0,
            api_key=os.getenv("GROQ_API_KEY"),
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            temperature=0,
            google_api_key=os.getenv("GOOGLE_API_KEY"),
        )
    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model="claude-sonnet-4-6",
            temperature=0,
            api_key=os.getenv("ANTHROPIC_API_KEY"),
        )
    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0,
            api_key=os.getenv("OPENAI_API_KEY"),
        )
    elif provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model="llama3.1",
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            temperature=0,
        )
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {provider}")


EXTRACTION_PROMPT = PromptTemplate(
    input_variables=["text"],
    template="""You are an expert invoice data extractor. Extract structured data from the following invoice text.
The invoice may be in Indonesian, English, or mixed language.

Invoice text:
---
{text}
---

Extract the following fields and return ONLY a valid JSON object. For each field, provide the value and a confidence score (0-100).
Use null for missing fields. Do not add any explanation outside the JSON.

Return this exact JSON structure:
{{
  "vendor_name": {{"value": "...", "confidence": 90}},
  "invoice_number": {{"value": "...", "confidence": 95}},
  "invoice_date": {{"value": "YYYY-MM-DD or null", "confidence": 80}},
  "due_date": {{"value": "YYYY-MM-DD or null", "confidence": 75}},
  "currency": {{"value": "IDR or USD or ...", "confidence": 95}},
  "subtotal": {{"value": "numeric string or null", "confidence": 85}},
  "tax_amount": {{"value": "numeric string or null", "confidence": 80}},
  "total_amount": {{"value": "numeric string or null", "confidence": 90}},
  "line_items": [
    {{"description": "...", "quantity": 1.0, "unit_price": 1000.0, "total": 1000.0}}
  ]
}}

Important:
- For Indonesian invoices: "Tanggal" = date, "Jatuh Tempo" = due date, "Subtotal" = subtotal, "PPN" = tax (usually 11%), "Total" = total
- Remove thousand separators (dots in IDR: 1.000.000 = 1000000)
- All amounts should be plain numbers without currency symbols
"""
)


def extract_invoice_fields(raw_text: str) -> dict:
    """Use LangChain + LLM to extract structured invoice data from OCR text."""
    if not raw_text or len(raw_text.strip()) < 20:
        return _empty_result()

    try:
        llm = get_llm()
        chain = EXTRACTION_PROMPT | llm
        result = chain.invoke({"text": raw_text[:4000]})

        # Parse JSON from response
        response_text = result.content if hasattr(result, "content") else str(result)

        # Extract JSON from response (handle markdown code blocks)
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if not json_match:
            return _empty_result()

        data = json.loads(json_match.group())
        return data

    except Exception as e:
        print(f"Extraction error: {e}")
        return _empty_result()


def _empty_result() -> dict:
    return {
        "vendor_name": {"value": None, "confidence": 0},
        "invoice_number": {"value": None, "confidence": 0},
        "invoice_date": {"value": None, "confidence": 0},
        "due_date": {"value": None, "confidence": 0},
        "currency": {"value": "IDR", "confidence": 50},
        "subtotal": {"value": None, "confidence": 0},
        "tax_amount": {"value": None, "confidence": 0},
        "total_amount": {"value": None, "confidence": 0},
        "line_items": [],
    }
