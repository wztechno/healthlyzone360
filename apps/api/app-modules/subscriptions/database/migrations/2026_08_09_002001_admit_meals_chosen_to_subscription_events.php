<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One more word in the subscription event vocabulary: `meals_chosen`.
 *
 * S1 wrote `event_type` as a bare string with a CHECK rather than as an enum
 * column precisely so that adding an event would be a migration somebody writes
 * on purpose. This is that migration, and the purpose is the Free Selection
 * choose-ahead surface (§7): `PUT /me/subscriptions/{subscription}/choices`
 * replaces a day's chosen meals, and a customer's own history has to be able to
 * say when they chose.
 *
 * The event carries a slot **count** and no dish names — see
 * `MealChoiceService` — so widening the vocabulary does not widen what a
 * support agent reading the journal can see about what somebody eats. The
 * choice rows themselves are the record.
 *
 * Additive: the CHECK is dropped and recreated with the existing fifteen words
 * plus this one. No row can violate it, because no row can already carry a word
 * the old constraint refused.
 */
return new class extends Migration
{
    private const string CONSTRAINT = 'subscription_events_type_check';

    /**
     * The vocabulary as it now stands, in the order S1 declared it.
     */
    private const string VOCABULARY = "'created', 'paused', 'resumed', 'cancelled', 'completed',
            'day_skipped', 'delivery_generated', 'delivery_cancelled', 'day_restored',
            'meal_substituted', 'no_safe_meal', 'address_changed', 'window_changed',
            'weekdays_changed', 'renewal_offered', 'meals_chosen'";

    /**
     * S1's original vocabulary, restated here rather than referenced, so that
     * `down()` restores exactly what was there rather than whatever the file it
     * pointed at says by then.
     */
    private const string ORIGINAL_VOCABULARY = "'created', 'paused', 'resumed', 'cancelled', 'completed',
            'day_skipped', 'delivery_generated', 'delivery_cancelled', 'day_restored',
            'meal_substituted', 'no_safe_meal', 'address_changed', 'window_changed',
            'weekdays_changed', 'renewal_offered'";

    public function up(): void
    {
        DB::statement('ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS '.self::CONSTRAINT);
        DB::statement('ALTER TABLE subscription_events ADD CONSTRAINT '.self::CONSTRAINT.' CHECK (event_type IN ('.self::VOCABULARY.'))');
    }

    public function down(): void
    {
        // Rows carrying the new word would refuse the narrower constraint, so
        // they go first. A reversal of "we started recording this" is "we no
        // longer have this record"; leaving the rows and failing the migration
        // would be worse, because it would make the rollback impossible rather
        // than lossy.
        DB::table('subscription_events')->where('event_type', 'meals_chosen')->delete();

        DB::statement('ALTER TABLE subscription_events DROP CONSTRAINT IF EXISTS '.self::CONSTRAINT);
        DB::statement('ALTER TABLE subscription_events ADD CONSTRAINT '.self::CONSTRAINT.' CHECK (event_type IN ('.self::ORIGINAL_VOCABULARY.'))');
    }
};
