# Docker Compose (Tier 1)

Bare Docker: the published image, Postgres, and S3-compatible storage. MinIO
is only the local-dev profile.

## Install

```bash
cp deploy/docker-selfhost/.env.example .env
docker compose -f deploy/docker-selfhost/infra/compose.yml up -d
```

Open `/setup`.
