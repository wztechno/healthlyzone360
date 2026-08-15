<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An offer of membership in an organisation, made to an email address.
 *
 * B1 needs it because provisioning a corporate buyer creates one organisation
 * and then has to get that company's staff into it — the alternative being an
 * operator creating accounts on other people's behalf and mailing them
 * passwords, which is the thing this table exists to avoid.
 *
 * **The token is never stored.** `token_hash` is a SHA-256 of an opaque
 * random value that exists exactly once, in the invitation email. The
 * platform can verify a token it is shown and can never reproduce one it
 * issued — so a database read, a backup, or a log line cannot be turned into
 * an accepted invitation. A plain-text token column would make every one of
 * those a credential leak.
 *
 * SHA-256 rather than a password hash: the token is 256 bits of entropy the
 * platform generated, not a human-chosen secret, so there is nothing for a
 * work factor to defend against and a constant-time lookup by digest is what
 * the accept path actually needs.
 *
 * **`role_code`, not a role foreign key.** An invitation names the role a
 * person should get *by its stable code*, and the role row it will resolve to
 * may not exist in the organisation yet — provisioning creates the
 * organisation's roles from the platform templates, and an invitation issued
 * mid-flight would otherwise point at nothing. The code is the contract; the
 * resolution happens at accept time, where a code that no longer resolves is a
 * refusal the person can be told about rather than a foreign key violation
 * they cannot.
 *
 * **One live invitation per person per organisation**, enforced by a partial
 * unique index over accepted-and-not-revoked. Re-inviting somebody is a real
 * operation — the first mail was lost, the address was mistyped — and it
 * should replace the outstanding offer rather than accumulate offers, because
 * two live tokens for one seat means revoking one achieves nothing. Terminal
 * rows accumulate freely: the history of who was invited and what became of it
 * is the audit trail.
 *
 * `expires_at` is not nullable. An invitation that never expires is a standing
 * credential attached to an email address the company may have decommissioned.
 *
 * Isolation strategy: **`org-rls` for management, `capability-token` for
 * acceptance** — and the two halves are why no PostgreSQL policy is added in
 * B1. The person accepting is by definition not yet a member, so they carry no
 * organisation context; a policy keyed on `app.organisation_id` would make the
 * accept path unable to find the row it was given a token for. Expressing both
 * halves needs the `org-or-token` OR-policy shape `customer_accounts` uses for
 * `org-or-user`, and it belongs in the same commit as the accept endpoint —
 * which is the integrator's. Recorded as a seam, not left silent: this is the
 * one B1 table that genuinely wants a policy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organisation_invitations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            // Scope of the membership being offered; null = organisation-wide.
            $table->foreignUuid('branch_id')->nullable()->constrained('organisation_branches')->nullOnDelete();

            $table->string('email', 160)->comment('as typed, for the mail and for the person to recognise');
            $table->string('email_normalised', 160)->comment('lowercased and trimmed — what uniqueness compares');
            $table->string('role_code', 60)->comment('resolved against roles at accept time, deliberately not an FK');

            $table->char('token_hash', 64)->comment('SHA-256 of the opaque token; the token itself exists only in the email');
            $table->timestamp('expires_at');

            $table->timestamp('accepted_at')->nullable();
            $table->foreignUuid('accepted_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('revoked_at')->nullable();
            $table->foreignUuid('revoked_by')->nullable()->constrained('users')->nullOnDelete();

            $table->foreignUuid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('message')->nullable()->comment('a line from the person inviting; shown in the mail');

            $table->timestamps();

            $table->unique('token_hash');
            $table->index(['organisation_id', 'accepted_at']);
            $table->index('expires_at');
        });

        // Accepted and revoked are mutually exclusive outcomes.
        DB::statement('ALTER TABLE organisation_invitations ADD CONSTRAINT organisation_invitations_outcome_check CHECK (accepted_at IS NULL OR revoked_at IS NULL)');

        // An acceptance names who accepted. Without it the membership it
        // produced cannot be traced back to the offer.
        DB::statement('ALTER TABLE organisation_invitations ADD CONSTRAINT organisation_invitations_accepted_by_check CHECK (accepted_at IS NULL OR accepted_by_user_id IS NOT NULL)');

        // One outstanding offer per address per organisation.
        DB::statement('CREATE UNIQUE INDEX organisation_invitations_live_unique ON organisation_invitations (organisation_id, email_normalised) WHERE accepted_at IS NULL AND revoked_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('organisation_invitations');
    }
};
