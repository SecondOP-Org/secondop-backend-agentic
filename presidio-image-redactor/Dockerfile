FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr libtesseract-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=10 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/health')"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3000"]
