<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The subscription's own story, in its own words.
 *
 * **Why this exists beside `audit_logs` rather than instead of it.** Every
 * transition here is *also* recorded as a `subscription.*` audit event, and
 * that is not duplication — the two answer different questions to different
 * readers. `audit_logs` is the platform's forensic record: who did what, under
 * which correlation identifier, with a redactor that blanks any metadata key
 * containing `code` and a retention policy that will one day trim it. This
 * table is *customer-facing history* — the list a subscriber sees when they ask
 * "what happened to my plan", and the list a support agent reads before
 * answering. It outlives audit retention, it is safe to render, and it may
 * carry an allergen class list, which the audit redactor cannot.
 *
 * It is deliberately **slim**: an event type, the date it concerns, and a small
 * jsonb `detail`. No actor identity beyond the nullable `actor_user_id` — a
 * generated delivery has no actor at all, and inventing a system user to fill
 * the column would make the audit question "was this a person?" unanswerable.
 *
 * **Append-only by construction**, not by convention: nothing in this module
 * updates or deletes a row here, and there is no `updated_at`. A story that can
 * be edited is not evidence.
 *
 * `event_type` is a bare string with a CHECK rather than an enum column, so
 * adding an event is a migration somebody writes on purpose.
 *
 * Isolation strategy: `join-rls-parent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_events', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            $table->foreignUuid('subscription_id')->constrained('subscriptions')->cascadeOnDelete();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->foreignUuid('subscription_delivery_id')->nullable()->constrained('subscription_deliveries')->nullOnDelete();

            $table->string('event_type', 40);
            $table->date('delivery_date')->nullable()->comment('the day it concerns, when it concerns one');
            $table->jsonb('detail')->default(DB::raw("'{}'::jsonb"))->comment('a small, renderable bag — safe for a customer to read');

            $table->foreignUuid('actor_user_id')->nullable()->comment('null when the platform did it; no invented system user')->constrained('users')->nullOnDelete();
            $table->timestamp('occurred_at');

            // `created_at` only. There is no `updated_at`, because there is no
            // update: an append-only ledger with a modification timestamp is a
            // ledger somebody intends to modify.
            $table->timestamp('created_at')->nullable();

            $table->index(['subscription_id', 'occurred_at']);
        });

        DB::statement("ALTER TABLE subscription_events ADD CONSTRAINT subscription_events_type_check CHECK (event_type IN (
            'created', 'paused', 'resumed', 'cancelled', 'completed',
            'day_skipped', 'delivery_generated', 'delivery_cancelled', 'day_restored',
            'meal_substituted', 'no_safe_meal', 'address_changed', 'window_changed',
            'weekdays_changed', 'renewal_offered'
        ))");
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_events');
    }
};
