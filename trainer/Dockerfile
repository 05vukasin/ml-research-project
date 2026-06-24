FROM python:3.12-slim

# Install Java for PMML export (sklearn2pmml requires JVM)
RUN apt-get update && apt-get install -y --no-install-recommends \
        default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /trainer

# Install Python dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ app/

# Models and data are bind-mounted at runtime
ENV MODELS_DIR=/models
ENV DATA_DIR=/data
ENV INFERENCE_URL=http://inference:8000

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
