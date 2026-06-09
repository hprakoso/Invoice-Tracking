from pydantic import BaseModel
from typing import Optional, List

class LineItem(BaseModel):
    description: str
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total: float

class FieldConfidence(BaseModel):
    value: Optional[str] = None
    confidence: float  # 0-100

class OCRExtractRequest(BaseModel):
    file_path: str
    invoice_id: str

class OCRExtractResponse(BaseModel):
    vendor_name: Optional[FieldConfidence] = None
    invoice_number: Optional[FieldConfidence] = None
    invoice_date: Optional[FieldConfidence] = None
    due_date: Optional[FieldConfidence] = None
    currency: Optional[FieldConfidence] = None
    subtotal: Optional[FieldConfidence] = None
    tax_amount: Optional[FieldConfidence] = None
    total_amount: Optional[FieldConfidence] = None
    line_items: List[LineItem] = []
    raw_text: str = ""
    overall_confidence: float = 0.0
