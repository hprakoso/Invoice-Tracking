from fastapi import APIRouter, HTTPException
from app.models.schemas import OCRExtractRequest, OCRExtractResponse, FieldConfidence
from app.services.ocr_service import extract_text_from_file
from app.services.extraction_chain import extract_invoice_fields
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/extract", response_model=OCRExtractResponse)
async def extract_invoice(request: OCRExtractRequest):
    """Extract structured data from an invoice file using OCR + LLM."""
    try:
        # Step 1: OCR
        raw_text = extract_text_from_file(request.file_path)

        # Step 2: LLM extraction
        extracted = extract_invoice_fields(raw_text)

        # Step 3: Map to response schema
        def to_field(key: str) -> FieldConfidence:
            field = extracted.get(key, {})
            if isinstance(field, dict):
                return FieldConfidence(
                    value=str(field.get("value")) if field.get("value") is not None else None,
                    confidence=float(field.get("confidence", 0)),
                )
            return FieldConfidence(value=None, confidence=0)

        # Calculate overall confidence (average of non-null fields)
        fields = ["vendor_name", "invoice_number", "invoice_date", "due_date",
                  "total_amount", "tax_amount", "subtotal"]
        confidences = [
            extracted.get(f, {}).get("confidence", 0)
            for f in fields
            if extracted.get(f, {}).get("value") is not None
        ]
        overall = sum(confidences) / len(confidences) if confidences else 0

        line_items = extracted.get("line_items", [])

        return OCRExtractResponse(
            vendor_name=to_field("vendor_name"),
            invoice_number=to_field("invoice_number"),
            invoice_date=to_field("invoice_date"),
            due_date=to_field("due_date"),
            currency=to_field("currency"),
            subtotal=to_field("subtotal"),
            tax_amount=to_field("tax_amount"),
            total_amount=to_field("total_amount"),
            line_items=line_items if isinstance(line_items, list) else [],
            raw_text=raw_text[:500],  # Truncate for response size
            overall_confidence=round(overall, 1),
        )

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Invoice file not found")
    except Exception as e:
        logger.error("OCR extraction failed", exc_info=True)
        raise HTTPException(status_code=500, detail="OCR processing failed")
