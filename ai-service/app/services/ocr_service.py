import os
import tempfile
from pathlib import Path
from PIL import Image
import pytesseract

def extract_text_from_file(file_path: str) -> str:
    """Extract raw text from PDF, scanned PDF, JPG, or PNG."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = path.suffix.lower()

    if ext in ['.jpg', '.jpeg', '.png', '.tiff', '.bmp']:
        img = Image.open(file_path)
        text = pytesseract.image_to_string(img, lang='ind+eng', config='--psm 6')
        return text

    elif ext == '.pdf':
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(file_path)
            all_text = []
            for page in doc:
                text = page.get_text()
                if text.strip():
                    all_text.append(text)
                else:
                    # Scanned page — render to image and OCR
                    mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for better OCR
                    pix = page.get_pixmap(matrix=mat)
                    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                        pix.save(tmp.name)
                        img = Image.open(tmp.name)
                        text = pytesseract.image_to_string(img, lang='ind+eng', config='--psm 6')
                        all_text.append(text)
                        os.unlink(tmp.name)
            doc.close()
            return '\n'.join(all_text)
        except ImportError:
            # Fallback: pdf2image
            from pdf2image import convert_from_path
            images = convert_from_path(file_path, dpi=200)
            texts = [pytesseract.image_to_string(img, lang='ind+eng', config='--psm 6') for img in images]
            return '\n'.join(texts)

    else:
        raise ValueError(f"Unsupported file type: {ext}")
