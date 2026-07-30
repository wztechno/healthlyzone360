# Starter-kit authentication inventory (pre-removal)

> Recorded before stripping the Laravel React starter kit (plan §5: "Do not remove starter-kit code
> until its authentication behaviour and dependencies have been identified"). Snapshot of
> `apps/api` as adopted, 2026-07-30.

## Fortify wiring

- **Provider**: `App\Providers\FortifyServiceProvider` (registered in `bootstrap/providers.php`).
  - **Response bindings** (singletons): `LoginResponse`, `RegisterResponse`, `TwoFactorLoginResponse`,
    `VerifyEmailResponse` — each returned JSON (`{"two_factor": false}` 200/201, or 204 for
    verification) when `wantsJson()`, otherwise redirected to the current **team** path via the
    `RedirectsToCurrentTeam` concern (`/{team-slug}/dashboard`).
  - **Actions**: `Fortify::createUsersUsing(CreateNewUser)` — validated `name/email/password`
    (via `PasswordValidationRules` + `ProfileValidationRules` concerns) and, inside a transaction,
    created the user **and a personal team** (`App\Actions\Teams\CreateTeam`).
    `Fortify::resetUserPasswordsUsing(ResetUserPassword)` — plain password reset, no team coupling.
  - **Views**: Inertia renders for login, register, forgot/reset password, verify-email and
    two-factor challenge. Login and register views also resolved a pending **team invitation** from
    a `?invitation=` query parameter (querying `TeamInvitation`).
  - **Rate limiters**: `login` — 5/min by transliterated lowercase username + IP;
    `two-factor` — 5/min by `login.id` session value.

## config/fortify.php

- `guard` = `web`, `passwords` broker = `users`, `username`/`email` = `email`,
  `lowercase_usernames` = true.
- `home` = `/dashboard` (redirect target, team-prefixed by the response classes).
- `prefix` = `''`, `middleware` = `['web']` — Fortify routes sat at the web root.
- `views` = `true` — Fortify registered GET view routes (now `false`; Phase 4 serves JSON only).
- **Features enabled**: `registration`, `resetPasswords`, `emailVerification`,
  `twoFactorAuthentication` with `confirm => true`, `confirmPassword => false`.

## Two-factor flow

- `App\Models\User` used `Laravel\Fortify\TwoFactorAuthenticatable`.
- Columns `two_factor_secret` (text), `two_factor_recovery_codes` (text),
  `two_factor_confirmed_at` (timestamp) were added by a separate add-on migration
  `2025_08_14_170933_add_two_factor_columns_to_users_table` (now merged into the canonical users
  migration, plan §5.10).
- **Encryption is owned by Fortify**: `EnableTwoFactorAuthentication` /
  `GenerateNewRecoveryCodes` write with `Fortify::currentEncrypter()->encrypt(...)`, and
  `TwoFactorAuthenticatable` decrypts on read. A model-level `encrypted` Eloquent cast would
  double-encrypt writes and double-decrypt reads, so the Healthy360 `User` model deliberately does
  **not** cast those two columns; they remain encrypted at rest by Fortify itself.
- Challenge UI was an Inertia page (`auth/two-factor-challenge`); confirmation required
  (`confirm => true`), password confirmation before enabling not required (`confirmPassword => false`).
- The `two-factor` rate limiter and `TwoFactorLoginResponse` binding complete the flow.

## Routes (starter)

- Fortify's own routes (login, logout, register, password reset, email verification,
  two-factor) — registered automatically at the web root because `views => true`, `prefix => ''`.
- `routes/web.php`: Inertia welcome page; `/{current_team}/dashboard` behind
  `auth + verified + EnsureTeamMembership`; team-invitation accept/decline routes.
- `routes/settings.php`: profile edit/update/destroy, security (password update, 2FA settings via
  `SecurityController` + `TwoFactorAuthenticationRequest`), appearance, and full team CRUD
  (switch/leave/members/invitations) behind `EnsureTeamMembership`.
- `routes/console.php`: daily schedule pruning expired `TeamInvitation` rows.

## Teams coupling (all removed)

- Models `Team`, `TeamInvitation`, `Membership` (+ factories); concerns `HasTeams`,
  `GeneratesUniqueTeamSlugs`; `Actions/Teams/CreateTeam`; data objects `TeamPermissions`,
  `UserTeam`; enums `TeamPermission`, `TeamRole`; controllers/requests/rules/policies/notifications
  for teams; middleware `EnsureTeamMembership` (route-model team scoping) and `SetTeamUrlDefaults`
  (URL::defaults for `{current_team}`); migrations `create_teams_table` and
  `add_current_team_id_to_users_table`; `users.current_team_id` column.
- Auth coupling points: registration created a personal team; all four Fortify response classes
  redirected into the current team's URL space; login/register views resolved team invitations.
- Healthy360 replaces the teams concept entirely with organisations/branches/memberships
  (foundation ERD); nothing from the teams domain is reused.

## Frontend coupling (removed)

- Inertia/React SPA (`resources/js`, `resources/views/app.blade.php`, `config/inertia.php`,
  `HandleInertiaRequests` + `HandleAppearance` middleware, Vite/TypeScript/ESLint/Prettier config,
  `package.json`). Composer packages `inertiajs/inertia-laravel` and `laravel/wayfinder` removed.
- `laravel/chisel` removed: it is the starter kit's code-removal toolkit (build-time tooling for
  stripping starter features), referenced nowhere in the application; the strip was performed
  manually and permanently. `laravel/pail` and `laravel/pao` kept — backend dev tools (log tailing,
  agent-optimised test output).

## Kept

- Fortify installed and its provider registered, Inertia-free: response bindings, view closures and
  team lookups removed; `views => false`; `home` retained pending Phase 4 JSON conversion;
  rate limiters (`login`, `two-factor`) retained; `CreateNewUser` (user only, no team) and
  `ResetUserPassword` retained; `PasswordValidationRules` retained.
- Full JSON conversion of the auth flows under `/api/v1/auth/*` is Phase 4; in Phase 3 the
  application boots and passes tests without exercising any auth HTTP route.
