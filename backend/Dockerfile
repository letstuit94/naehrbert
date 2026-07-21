FROM python:3.11-slim

# tesseract-ocr + German model for Epic 3's local OCR pipeline;
# libglib2.0-0 is required by opencv-python-headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-deu \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY BLS_data BLS_data

ENV PYTHONPATH=/app

EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
