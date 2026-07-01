FROM ghcr.io/berriai/litellm-database:latest

COPY config.example.yaml /app/config.yaml

EXPOSE 4000

ENTRYPOINT []
CMD ["sh", "-c", "litellm --config /app/config.yaml --host 0.0.0.0 --port ${PORT:-4000}"]
