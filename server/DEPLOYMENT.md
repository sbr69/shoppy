# Production reconciliation

Every pending merchant confirmation is persisted in Supabase's `reconciliation_jobs` table. Workers atomically claim rows with `FOR UPDATE SKIP LOCKED`, so any number of API instances or schedulers can run safely and a restart cannot lose work.

No external scheduler or reconciliation endpoint is required. Each API
instance runs the worker, and Postgres job claims make concurrent workers safe.
The worker resumes eligible jobs after an API restart.

The API endpoint and worker only confirm a merchant order after observing the existing Stellar transaction. They never submit another payment.
