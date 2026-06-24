FROM python:3.12-slim

# Install Java for PMML export (sklearn2pmml requires JVM)
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy training scripts (repo is bind-mounted at runtime, but copy for image self-sufficiency)
COPY . /app/training/

CMD ["/bin/bash"]
