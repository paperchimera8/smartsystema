# Infrastructure

Local development starts with:

```bash
docker compose -f infra/docker-compose.yml up -d
```

The compose stack provides:

- PostgreSQL with pgvector for relational data, metadata snapshots, draft state, and vector-assisted resolution.
- Redis for BullMQ queues.
- MinIO as an S3-compatible object store for uploaded documents and OCR artifacts.

