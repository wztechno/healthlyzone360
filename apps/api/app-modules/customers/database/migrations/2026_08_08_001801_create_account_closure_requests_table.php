<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Close my account" — the request, not the closure.
 *
 * **Why a row at all.** Closure is not one act. Somebody asks, proves it is
 * really them, waits out whatever grace window is configured, and only then is
 * anything erased — and at every one of those points the request can be
 * refused by a blocker, cancelled by the person, or picked up by a queue worker
 * that has to know what it is finishing. A closure held in a session or in a
 * job payload could not answer "what did I ask for and where has it got to",
 * which is the question the whole journey is built around.
 *
 * **`scope` is the fork in the journey and is a column rather than two
 * tables.** `marketing_opt_out` is somebody saying "stop emailing me"; it takes
 * effect immediately, needs no proof, and deletes nothing. `full` is somebody
 * saying "forget me", which is irreversible and therefore step-up proven. They
 * are the same request from the customer's side — one screen, one reason, one
 * confirmation — and separating them into two tables would make the honest
 * reporting question ("how many people left us last month, and why") a union.
 *
 * **`reason_code` is a fixed vocabulary** (`ClosureReasonCode`, CHECK below).
 * Free text is how personal data ends up in a column nobody classified, and
 * "why do people leave" is read by machines as often as by people.
 * `reason_note` exists beside it for the person who wants to say more, is
 * optional, and is deleted with everything else at finalisation — it is the one
 * field here that can contain prose about a human being.
 *
 * **`otp_challenge_id` is nullable then required.** A request starts unproven,
 * so the column cannot be NOT NULL; but a `full` request that has reached
 * `verified` and beyond must carry the exact challenge it was proven with,
 * which is what `account_closure_requests_proof_check` enforces. Binding the
 * challenge to the *request* rather than trusting a purpose-scoped step-up flag
 * is the point: a code obtained for one closure request cannot be replayed to
 * finalise a different one, including a support-initiated one the customer
 * never agreed to.
 *
 * **It carries no foreign key, and that is the same argument
 * `closed_account_tombstones` makes.** The challenge row is personal data — it
 * holds a masked destination — and finalisation deletes it along with the
 * contact point it was issued against. A `nullOnDelete` would then blank this
 * column mid-erasure and break the very CHECK above; a `restrictOnDelete` would
 * refuse to let the erasure delete the challenge at all. Both are the
 * constraint fighting the thing the table exists to record. So the column
 * records *which challenge proved this*, permanently, and outlives the row it
 * names — exactly as a tombstone outlives the identity it marks. Referential
 * integrity while the request is in flight is the service's, which is the only
 * thing that ever writes here.
 *
 * **`initiated_by_user_id` is the support-initiated case and is deliberately
 * separate from `user_id`.** Support may open a closure on a customer's behalf
 * — a phone call, an accessibility need — but the proof still goes to the
 * customer's own destination, so the actor who started it and the identity
 * being closed are two different people and must be two different columns.
 * NULL means the customer did it themselves.
 *
 * **`blockers` is a snapshot, not a source of truth.** It records what the
 * registry said at the last evaluation so a screen can explain a refusal
 * without re-running six queries, and so an audit reader can see what the
 * platform believed at the moment it agreed to schedule. The finalisation job
 * re-runs every blocker regardless: a subscription started during the grace
 * window is exactly the thing a cached verdict would miss.
 *
 * No soft deletes (§B.2). A closure request that has completed is the record of
 * a person's decision and stays; what goes is the personal data it pointed at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_closure_requests', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('user_id')->comment('the identity being closed; never the support actor')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->comment('NULL when the person holds no customer account — a staff-only login closing')->constrained('customer_accounts')->nullOnDelete();

            $table->string('reason_code', 40)->comment('ClosureReasonCode; a fixed vocabulary, never free text');
            $table->text('reason_note')->nullable()->comment('optional prose from the customer; deleted at finalisation with everything else');
            $table->string('scope', 20)->comment('marketing_opt_out | full');
            $table->string('status', 20)->default('requested')->comment('requested | verified | scheduled | completed | cancelled');

            $table->uuid('otp_challenge_id')->nullable()->comment('the challenge this request was proven with; bound at verify, never reused across requests. No FK — see the class docblock');
            $table->foreignUuid('initiated_by_user_id')->nullable()->comment('a support actor; NULL means the customer asked themselves')->constrained('users')->nullOnDelete();

            $table->timestamp('requested_at');
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('scheduled_for')->nullable()->comment('when the grace window runs out; equals requested_at when the window is zero');
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancelled_because', 40)->nullable()->comment('customer_cancelled | blocked | superseded');

            $table->jsonb('blockers')->default('[]')->comment('the last registry verdict, for explaining a refusal; never trusted at finalisation');

            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index(['status', 'scheduled_for']);
        });

        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_scope_check CHECK (scope IN ('marketing_opt_out', 'full'))");
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_status_check CHECK (status IN ('requested', 'verified', 'scheduled', 'completed', 'cancelled'))");
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_reason_check CHECK (reason_code IN ('no_longer_needed', 'too_expensive', 'moving_away', 'dietary_needs_unmet', 'service_quality', 'privacy_concerns', 'duplicate_account', 'other'))");
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_cancelled_because_check CHECK (cancelled_because IS NULL OR cancelled_because IN ('customer_cancelled', 'blocked', 'superseded'))");

        // A state that cannot say when it was entered is a state somebody can
        // set silently — the same rule customer_accounts and users are held to.
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_verified_at_check CHECK (status <> 'verified' OR verified_at IS NOT NULL)");
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_scheduled_for_check CHECK (status <> 'scheduled' OR scheduled_for IS NOT NULL)");
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_completed_at_check CHECK (status <> 'completed' OR completed_at IS NOT NULL)");
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_cancelled_at_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))");

        // The proof rule, in the schema rather than only in the service. A full
        // closure that has moved past `requested` without a challenge attached
        // is an erasure nobody proved, and the database refuses to hold one.
        // Marketing opt-out is exempt by construction: it deletes nothing, so
        // demanding a passcode for it would be friction with no protective
        // effect.
        DB::statement("ALTER TABLE account_closure_requests ADD CONSTRAINT account_closure_requests_proof_check CHECK (scope <> 'full' OR status IN ('requested', 'cancelled') OR otp_challenge_id IS NOT NULL)");

        // One live request per identity. Partial, so the history of everything
        // somebody has ever asked for survives beside it — and so a cancelled
        // request never blocks a fresh one.
        DB::statement("CREATE UNIQUE INDEX account_closure_requests_live_unique ON account_closure_requests (user_id) WHERE status IN ('requested', 'verified', 'scheduled')");
    }

    public function down(): void
    {
        Schema::dropIfExists('account_closure_requests');
    }
};
