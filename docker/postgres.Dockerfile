# pgvector's image, plus pg_cron so the database schedules its own maintenance
# instead of depending on an external cron that moves when you change hosts.
#
# postgres:17-alpine cannot host this schema: 0001_schema.sql needs pgvector for
# document_chunks.embedding, and 0008_cron.sql schedules five maintenance jobs
# through pg_cron.
FROM pgvector/pgvector:pg17

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-cron \
 && rm -rf /var/lib/apt/lists/*
