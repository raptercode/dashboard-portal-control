# ADR 0026: The owner can read and edit the complete project environment

- Status: Accepted
- Date: 2026-09-11

The owner requested visible ENV values, file uploads and editing several variables as a `.env` document because masking prevented routine configuration edits. The authenticated project environment endpoint now returns the complete document, including previously masked values; this supersedes the environment read restrictions in ADR 0006 and ADR 0008, while retaining encryption at rest and metadata-only project lists and audit events. Git credentials and other credential APIs keep their existing disclosure rules.

Uploads merge into a local draft by key, and saving the editor replaces the complete environment: omitted keys are deleted and `KEY=` is an empty value. The owner can save without deploying; changes apply to the next deployment. Saving remains session- and CSRF-protected, the read response uses `Cache-Control: no-store`, and the draft is not stored in browser storage.

No data migration or encryption-key change is required. Old sensitivity metadata is ignored when reading and removed on the next save. Legacy row-patch clients retain their blank-means-keep behavior; only explicit document replacement can clear values or remove keys.
