# Row-Level Security — implementation notes

> Execution Phase 6. Companion to `03-identity-tenancy-and-access.md`, ADR-0007 and plan §11–§12.
> This note records what was **built**, the decisions taken where the plan left a choice, and what
> deliberately does **not** exist yet. Nothing here claims more than the code does.

## 1. Connection and role architecture

Three PostgreSQL roles, provisioned by `infrastructure/docker/postgres/init/01-roles-and-databases.sh`:

| Role | Attributes | Used by |
| --- | --- | --- |
| `healthy360_migrator` | owns `public` and every table; `CREATEDB`; `NOBYPASSRLS` | migrations, seeders, `db:wipe` |
| `healthy360_app` | owns nothing; `NOBYPASSRLS`; no DDL | the running application |
| `healthy360_test` | application-equivalent privileges | the RLS test suite via `SET ROLE` |

The migrator is a **member of** both runtime roles (`GRANT healthy360_app TO healthy360_migrator`,
same for `healthy360_test`). That is role membership, not privilege escalation: it is what lets a
test session connected as the owner execute statements *as* the runtime role, with the policies in
force. The grants were added to the init script for clean clones and applied to the existing
container with `docker exec … psql`, because the volume predates them.

RLS is **enabled, not forced**. The migrator owns the tables and therefore bypasses the policies —
which is precisely how migrations and seeders keep working — while `healthy360_app` owns nothing
and is fully subject to them.

### Laravel connections

| Connection | Credential | Purpose |
| --- | --- | --- |
| `pgsql` (default) | `DB_USERNAME` — `healthy360_app` | everything the application does at runtime |
| `pgsql_migrations` | `DB_MIGRATIONS_USERNAME` — `healthy360_migrator` | schema changes and seeding |

Both point at the same host, port and database; only the credential differs, so pointing the
application at another database can never leave migrations behind on the old one.

**Mechanism chosen for migrations: `--database=pgsql_migrations`**, not an environment swap.

Laravel's `Migrator::setConnection()` sets the resolver's *default* connection for the duration, and
both `migrate --seed` and `migrate:fresh --seed` run their seeder inside that window (`FreshCommand`
passes `--database` to `db:seed` explicitly; `MigrateCommand` runs it inside
`Migrator::usingConnection()`). Models used by seeders therefore resolve to the migrator connection
without any per-seeder plumbing. An environment-variable swap would have worked too, but is awkward
to express portably in a Composer script on Windows.

Wrappers so nobody has to remember it:

```
composer db:migrate   # php artisan migrate --database=pgsql_migrations --force
composer db:seed      # php artisan db:seed  --database=pgsql_migrations --force
composer db:fresh     # php artisan migrate:fresh --database=pgsql_migrations --seed --force
```

`scripts/setup.sh`, `scripts/setup.ps1`, `scripts/reset.sh` and `scripts/reset.ps1` use the same
flag.

## 2. Policies

Session context is read with `current_setting('app.…', true)`, so an unset variable yields NULL and
every predicate evaluates false. The reset path writes **empty strings** rather than unsetting the
variables — an empty string compares false against any UUID, so a reset session is exactly as closed
as one that never had context, and the statement never depends on a variable existing first.

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `organisation_branches` | organisation match | organisation match | organisation match | organisation match |
| `feature_entitlements` | organisation match | organisation match | organisation match | organisation match |
| `organisation_memberships` | organisation match **OR** own user | organisation match | organisation match | organisation match |
| `roles` | `organisation_id IS NULL` **OR** organisation match | organisation match | organisation match | organisation match |
| `consent_grants` | own user **OR** (organisation not null **AND** organisation match) | same predicate | own user only | **no policy** |
| `audit_logs` | organisation match | `WITH CHECK (true)` | revoked at grant level | revoked at grant level |

"organisation match" is `organisation_id::text = current_setting('app.organisation_id', true)`;
"own user" is `user_id::text = current_setting('app.user_id', true)`.

Policies are granted `TO healthy360_app, healthy360_test`. The migration resolves that list from
`pg_roles`, so a database provisioned without the init script still gets RLS enabled — with no
policies, which is the correct fail-closed outcome for a non-owner — instead of aborting the schema
build.

### Decisions taken where the plan left a choice

- **`organisation_memberships` reads are wider than writes.** A person may list their own
  memberships across organisations, because `GET /api/v1/me` depends on it. Writes stay strictly
  organisation-scoped.
- **`roles` write predicates are organisation-match only, including UPDATE and DELETE.** The plan
  said platform templates must stay readable and that the application role must never write one.
  Allowing `organisation_id IS NULL` in the UPDATE `USING` clause would have let the runtime role
  claim a template by rewriting its `organisation_id` to the current organisation, so `USING` is
  organisation-match for UPDATE and DELETE and `NULL` appears only in the SELECT predicate.
- **`consent_grants` does get an UPDATE policy, restricted to the data subject.** Withdrawal is a
  status transition, not a deletion (`06-security-privacy-and-audit.md` §6), and it is the subject's
  act — organisation staff may read a grant but never rewrite it. There is deliberately **no DELETE
  policy at all**, so the application role cannot erase consent history under any context; the
  absence of a policy is the enforcement.
- **`audit_logs` accepts any insert.** An audit event must never be lost because the context was
  incomplete, and system events legitimately carry a NULL organisation. Reading is confined to the
  active organisation, and `UPDATE`/`DELETE` are revoked from both runtime roles, so tampering
  requires the migrator role — which the runtime never holds (plan §12).

The migration is reversible: `down()` re-grants `UPDATE, DELETE` on `audit_logs`, drops every policy
by name and disables RLS on the six tables. Policies are dropped before creation too, so a partially
applied migration can be re-run.

**No table outside the six is touched.** A test asserts exactly that list, so extending RLS is a
deliberate act with a failing test to prompt the decision (ADR-0007 review trigger).

## 3. Session-context bridge

`Healthy360\Tenancy\Database\DatabaseTenantContext` owns the three settings and remembers the last
applied snapshot, so a repeated apply costs nothing.

**The context republishes itself on every mutation.** `TenantContext` notifies a listener registered
by `TenancyServiceProvider`, which pushes the current values to the connection. This is deliberately
*not* driven from the middleware alone: `GET /api/v1/me` resolves a remembered organisation deep
inside `UserContextHydrator`, long after the middleware stack has run, and the database session has
to follow the context wherever it is set. Without this, a legitimate read would fail closed and
simply return nothing — the hardest possible symptom to diagnose.

- **Middleware.** One class, `SetDatabaseTenantContext` (alias `db.context`), sits immediately after
  `auth:sanctum` in `routes/api-v1.php` and publishes the authenticated identity. Two policies
  depend only on the user: own memberships and own consent grants. Organisation and branch arrive
  through the mutation listener when `org.context` / `branch.context` resolve them. Registering the
  middleware a second time after `org.context` would in any case be discarded — Laravel
  de-duplicates middleware names when it gathers a route's stack.
- **Reset.** `terminate()` clears the context after the response is on the wire, so a reused FPM or
  Octane worker never inherits the previous request's tenant.
- **Queue.** The existing `Context::dehydrating` / `Context::hydrated` propagation was kept; the
  hydration path now republishes to the database session for free, because it goes through
  `TenantContext::restore()`. The reset moved from `JobProcessed` + `JobFailed` to **`JobAttempted`**,
  which both `Worker::process()` and `SyncQueue::executeJob()` dispatch from a `finally` block. That
  is genuine finally semantics: the reset runs whether the job succeeded, threw or failed, which
  `JobProcessed` alone did not guarantee.
- **Reconnection.** A dropped connection comes back with an empty session, so a
  `ConnectionEstablished` listener republishes the remembered snapshot. Laravel dispatches that event
  from `DatabaseManager::reconnect()` as well as on first connection, and `Connection::reconnect()`
  routes through it — so the listener covers the reconnect path rather than only the first connect.
  It is a no-op when no context has been applied.

### Explicit, bounded bypasses

Two places legitimately run outside the ambient context. Both use
`DatabaseTenantContext::during()`, the database-session counterpart of the application layer's
`withoutTenancy()` — an auditable statement rather than an ambient escape:

1. **`ConsentLedger::grant()`** declares the data subject. Registration writes the first consent
   grants before anybody is authenticated, so there is no ambient identity to inherit; without this,
   `POST /api/v1/auth/register` fails the `WITH CHECK` and nobody can create an account.
2. **`ContextValidator::branch()`** declares the organisation of an already-proven active membership
   for one existence check. Context validation necessarily runs before the context it is validating
   exists; without this the branch is invisible and a valid selection is reported as "outside your
   scope".

## 4. Redaction and classification

- **`Healthy360\Support\Logging\RedactSensitiveContext`** — a Monolog processor with a
  case-insensitive substring key deny-list (`password`, `password_confirmation`, `token`,
  `access_token`, `secret`, `authorization`, `cookie`, `two_factor_secret`,
  `two_factor_recovery_codes`, `recovery_code`), recursive traversal of arrays, objects and
  `Throwable`s with a depth cap of 8, and value scrubbers for bearer/basic headers, Sanctum
  `id|token` strings, JWTs and email addresses (`n***@domain`). Message, context and extra all pass
  through it.
- **Wiring.** Laravel only honours the `processors` configuration key on `monolog`-driver channels,
  so the other channels take the processor through a `tap` (`RedactSensitiveLogs`). The `stack`
  driver collects its children's processors, so it needs no entry of its own. A test asserts the
  processor is attached to `single`, `daily`, `stack`, `stderr`, `syslog` and `errorlog`.
- **`Healthy360\Support\Enums\DataClassification`** — `public`, `internal`, `confidential`,
  `restricted`, `special_category`, with `requiresPurposeOfUse()` true for `special_category` only.
- **`#[Classified(DataClassification::…, 'column', …)]`** — repeatable, applicable to a class (naming
  Eloquent attributes, which are not PHP properties) or to a real typed property. `Classified::map()`
  reads the declarations, including inherited ones.
- **Applied to** `App\Models\User` (credentials restricted, email confidential),
  `Healthy360\Identity\Models\UserProfile` (person data confidential, preferences internal) and
  `Healthy360\Consent\Models\ConsentGrant` (consent as special category).

> **Honest scope.** The vocabulary, the declarations and the reader exist and are tested. **Nothing
> yet derives behaviour from them**: the redaction processor still works from its own key deny-list,
> no field encryption is driven by classification, and no runtime check refuses to serialise a
> `restricted` attribute. Enforcement machinery is deferred to the phase that also delivers the
> encryption service implementation.

## 5. Audit

- `Healthy360\Audit\Enums\PurposeOfUse` — `organisation_administration`, `self_service`, `support`,
  `security_investigation`. Clinical purposes are deliberately absent until the modules that need
  them exist; inventing values now would put unused vocabulary in a trail people are meant to trust.
- `AuditRecorder::recordAccess()` takes `PurposeOfUse` and `DataClassification` as **required**
  arguments, so an access event that cannot say why it happened will not compile. The Phase 4
  authentication listeners were reviewed and already record safe metadata (identifiers, IP, user
  agent, attempted email on failures) with the recorder's own redaction as the backstop; they were
  left unchanged.
- `GET /api/v1/organisations/current` is the exemplar: a successful read writes `access.read` with
  purpose `organisation_administration`, after the read succeeded.

> **Deviation from `06-security-privacy-and-audit.md` §3.1.** That table lists `classification` as a
> column on the audit event. It is currently recorded inside `metadata` instead; promoting it to a
> column is a one-line migration to be taken when the audit schema is next revised, and was not worth
> a schema change on its own in this phase.

## 6. Testing model

Recorded in full in `08-testing-and-quality.md` §1.5. In short: the test suite's default connection
is the **migrator**, because `RefreshDatabase` migrates on the default connection and the factories
that build two complete tenants necessarily write across organisations with no session context. The
database layer is proven instead by the `rls` group, whose statements — and, in
`RlsVerticalSliceTest`, whose entire HTTP requests — run under `SET ROLE healthy360_test`.

## 7. Known limitations and open questions

1. **`/api/v1/me` cannot report custom role codes from a non-active organisation.** `roles` is
   readable only for the active organisation plus platform templates, so a membership in another
   organisation whose role is organisation-scoped lists `roles: []`. Every seeded membership uses a
   platform template role, so the vertical slice is unaffected, and arguably one should not learn
   another organisation's role catalogue — but the `/me` contract does promise role codes per
   membership. A later phase should hydrate them through an explicit audited pathway.
2. **Audit rows with a NULL organisation are unreadable by the application role.** Authentication
   events recorded before any organisation is selected fall in this category. Platform-level audit
   reading is an administrative pathway, which plan §11 defers.
3. **The runtime role's context is per-connection, not per-statement.** An external connection pooler
   in transaction mode would break the model; ADR-0007 already names that as a review trigger.
4. **`healthy360_migrator` is a member of the runtime roles.** Harmless where the migrator is only
   used for DDL, but it means an operator holding the migrator credential can act as the application.
   Deployment should keep the migrator credential out of application configuration entirely.
5. **Feature tests run as the owner.** They exercise the application-layer defences by design, so a
   regression that *only* RLS would catch is caught by the `rls` group and not by the wider suite.
