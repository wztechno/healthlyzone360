<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The named slots a kitchen delivers in — "Morning", "Evening", "Weekend
 * lunch".
 *
 * Organisation-wide rather than per zone or per branch. A window is a
 * *vocabulary*: it is what a customer picks at checkout and what a production
 * schedule is drawn against, and a kitchen that named its slots differently in
 * each zone would have a customer choosing between "Morning" and "AM" without
 * being told they are the same van.
 *
 * **`weekdays` is an ISO-8601 array — 1 = Monday … 7 = Sunday — and an empty
 * array means every day.** The empty case is worth stating because it is the
 * common one: most windows run daily, and "no restriction" is the honest
 * encoding of that. It is deliberately *not* a NULL, so a client never has to
 * distinguish "unset" from "unrestricted" for a field where they mean the same
 * thing. A CHECK pins the type to an array; the membership and range rules are
 * enforced by the service, which can say "3 is not an ISO weekday" in a
 * sentence rather than by refusing a row.
 *
 * `starts_at` / `ends_at` are `time`, not `timestamp`: a delivery window is a
 * clock face, not an instant. "Evening" is 18:00–21:00 every day it runs, and
 * storing it as a timestamp would attach it to one date and one timezone. The
 * branch's timezone is the one it is read in (`organisation_branches.timezone`),
 * which is where a kitchen with locations in two countries needs it to live.
 *
 * Both ends are **nullable together in spirit and separately in fact**: a
 * kitchen that has named its slots before deciding their hours has a window
 * with no times, which is a legitimate half-finished state. The CHECK only
 * fires when both are present, and then it is strict — a window that ends when
 * it starts is not a window.
 *
 * **No overnight windows.** `ends_at > starts_at` refuses 22:00–02:00
 * outright, which is a real limitation and the right one for K1.7: an
 * overnight slot needs a day-rollover rule that order capture (C1) has to
 * agree with, and inventing it here — before anything reads it — would be
 * inventing a rule nobody has tested. A kitchen that needs one models it as
 * two windows until the rule exists.
 *
 * No `lock_version`, matching the plan vocabularies (K1.6): these rows carry
 * no concurrent-edit hazard worth a validator, and the `precondition`
 * middleware applies only to resources that do.
 *
 * Isolation strategy: `org-rls` in vocabulary, **app-scope** in K1.7 — a
 * delivery window is printed on the kitchen's own checkout page.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_windows', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('organisation_id')->constrained('organisations')->cascadeOnDelete();
            $table->string('code', 30);
            $table->string('name_en');
            $table->string('name_ar');
            $table->time('starts_at')->nullable();
            $table->time('ends_at')->nullable();
            $table->jsonb('weekdays')->default(DB::raw("'[]'::jsonb"))
                ->comment('ISO-8601 weekdays, 1 = Monday … 7 = Sunday; [] = every day');
            $table->integer('display_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['organisation_id', 'code']);
            $table->index(['organisation_id', 'is_active', 'display_order']);
        });

        DB::statement("ALTER TABLE delivery_windows ADD CONSTRAINT delivery_windows_weekdays_check CHECK (jsonb_typeof(weekdays) = 'array')");

        // Only when both ends are present, and then strict. A half-configured
        // window is a legitimate draft; a zero-length one is a mistake.
        DB::statement('ALTER TABLE delivery_windows ADD CONSTRAINT delivery_windows_time_order_check CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_windows');
    }
};
