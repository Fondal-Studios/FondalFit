# ADR-002 Base de datos
`node:sqlite` para desarrollo y tests (sin dependencias nativas), SQL portable.
Hecho: la capa `apps/api/src/db.ts` soporta PostgreSQL (`DATABASE_URL`, producción) y SQLite (desarrollo/tests) con SQL portable; la misma suite de 18 tests corre en ambos (CI incluye servicio Postgres). Se detectó un error real solo-PostgreSQL gracias a eso. Pendiente: migraciones versionadas, backups, cifrado en reposo.
