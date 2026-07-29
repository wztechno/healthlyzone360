# ADR-0010 — S3-compatible object storage behind the Laravel filesystem abstraction

## Status

Accepted — 2026-07-30.

## Context

The platform will store documents, attachments and media (deferred modules), and needs a local development object store now for infrastructure parity. MinIO was the conventional dev choice, but its community edition is archived and no longer publishes images. Garage (dxflrs/garage, v2) is an actively maintained, lightweight S3-compatible alternative. Production object storage will be whatever S3-compatible service the chosen host offers.

## Decision

- The application talks to object storage exclusively through Laravel's filesystem abstraction (`Storage` facade / flysystem S3 driver). **No Garage-specific API dependencies anywhere in application code.**
- Garage v2 is the local development and CI object store, provisioned via Docker Compose with scripted bucket setup.
- Any S3-compatible service (AWS S3, Cloudflare R2, host-native stores) is swappable via configuration only (endpoint, credentials, bucket).

## Consequences

- Zero code churn when production storage is selected; the swap is an `.env` change plus bucket provisioning.
- We accept the small risk of Garage-specific dev/prod behavioural differences (signature edge cases, consistency) — mitigated by keeping usage to plain S3 operations Laravel's driver emits.
- Bucket lifecycle policies, presigned-URL patterns and encryption-at-rest options must be validated against the actual production provider before any module stores sensitive documents.

## Review trigger

Re-examine when the production hosting/storage provider is chosen, if Garage v2 maintenance falters, or before the first module that stores clinical documents (which will add encryption and retention requirements).
