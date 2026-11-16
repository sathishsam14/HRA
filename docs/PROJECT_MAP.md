# Project Folder Map

- `app/`: Next.js App Router application containing all five production screens (Login, Dashboard, Rating Engine, MIS Report, Audit Trail), file upload screen, and backend API routes.
- `app/api/`: REST API endpoints for authentication, dashboard statistics, rating engine reviews/overrides/submissions, MIS reports, audit trail queries, and Excel exports.
- `components/`: Shared UI components including AppShell layout, navigation Sidebar, TopBar header, PageTitle, Pill badges, OverrideDialog modal, StepTile indicators, and ProtectedPage route guard.
- `data/`: Official source datasets, consolidated historical racing files (2022–2026), scenario test cases, regression coefficient references, and standard test fixtures.
- `docs/`: Technical and domain documentation including BRD specifications, rules summaries, data formats, and application architecture.
- `ftp-test/`: Local filesystem watcher directory simulating incoming FTPS/SFTP drops for automated background file processing.
- `lib/`: Core server and application libraries including authentication, database singleton, data import engine, and the rating computation engine.
- `lib/import/`: Multi-format parser and validator supporting Excel, Word, and PDF files for races, horses, starter reports, vet reports, and incident reports.
- `lib/rating-engine/`: Official BTC mathematical handicap rating engine implementing penalty calculations, regression formulas, and handicapper override logic.
- `prisma/`: Database schema definitions, PostgreSQL append-only triggers, migration scripts, and seed files for users and initial data.
- `public/`: Static web assets including the Bangalore Turf Club crest logo and login screen background.
- `scripts/`: Administrative utilities and command-line scripts for user management, historical data ingestion, and sample generation.
- `tests/`: Automated Vitest test suites covering database triggers, RBAC security, file import validation, rating math, API endpoints, and worker processing.
- `uploads/`: Server-side storage for safe copies of uploaded race sheets and steward/vet report files.
- `worker/`: Background service and cron scheduled tasks that monitor local, FTPS, and SFTP file sources for incoming race day files.
- `_review/`: Staging directory holding archived prototype assets, mock datasets, duplicate spreadsheets, and reference design mockups for review.
