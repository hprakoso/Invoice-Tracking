import os
import json
import re
from langchain_core.prompts import PromptTemplate
from langchain_core.language_models.chat_models import BaseChatModel

# Default models per provider — overridable via LLM_MODEL env var
DEFAULT_MODELS = {
    "groq": "llama-3.1-8b-instant",
    "gemini": "gemini-2.0-flash",
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4o-mini",
    "deepseek": "deepseek-chat",
    "ollama": "llama3.1",
}

def _get_timeout() -> int | None:
    val = os.getenv("LLM_TIMEOUT_SECONDS")
    if val:
        try:
            return int(val)
        except ValueError:
            pass
    return None

def get_llm() -> BaseChatModel:
    """Return configured LLM based on LLM_PROVIDER env var.

    Environment variables:
        LLM_PROVIDER          — groq | gemini | anthropic | openai | deepseek | ollama (default: groq)
        LLM_MODEL             — override the default model for the selected provider
        LLM_TIMEOUT_SECONDS   — request timeout in seconds (optional)
        GROQ_API_KEY          — API key for Groq
        GOOGLE_API_KEY        — API key for Google Gemini
        ANTHROPIC_API_KEY     — API key for Anthropic Claude
        OPENAI_API_KEY        — API key for OpenAI / DeepSeek
        DEEPSEEK_BASE_URL     — base URL for DeepSeek (default: https://api.deepseek.com/v1)
    """
    provider = os.getenv("LLM_PROVIDER", "groq").lower()
    model = os.getenv("LLM_MODEL") or DEFAULT_MODELS.get(provider, DEFAULT_MODELS["groq"])
    timeout = _get_timeout()

    if provider == "groq":
        from langchain_groq import ChatGroq
        kwargs = {"model": model, "temperature": 0, "api_key": os.getenv("GROQ_API_KEY")}
        if timeout:
            kwargs["timeout"] = timeout
        return ChatGroq(**kwargs)

    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        kwargs = {"model": model, "temperature": 0, "google_api_key": os.getenv("GOOGLE_API_KEY")}
        if timeout:
            kwargs["timeout"] = timeout
        return ChatGoogleGenerativeAI(**kwargs)

    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        kwargs = {"model": model, "temperature": 0, "api_key": os.getenv("ANTHROPIC_API_KEY")}
        if timeout:
            kwargs["timeout"] = timeout
        return ChatAnthropic(**kwargs)

    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        kwargs = {"model": model, "temperature": 0, "api_key": os.getenv("OPENAI_API_KEY")}
        if timeout:
            kwargs["timeout"] = timeout
        return ChatOpenAI(**kwargs)

    elif provider == "deepseek":
        from langchain_openai import ChatOpenAI
        kwargs = {
            "model": model,
            "temperature": 0,
            "api_key": os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY"),
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        }
        if timeout:
            kwargs["timeout"] = timeout
        return ChatOpenAI(**kwargs)

    elif provider == "ollama":
        from langchain_ollama import ChatOllama
        kwargs = {
            "model": model,
            "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            "temperature": 0,
        }
        return ChatOllama(**kwargs)

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
