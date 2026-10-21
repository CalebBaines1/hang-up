FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY download_models.sh .
RUN ./download_models.sh /models
COPY app.py .
ENV MODELS_DIR=/models
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
