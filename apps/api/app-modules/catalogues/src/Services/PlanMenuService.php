<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The fixed menu of one subscription plan, replaced as a set.
 *
 * A near-twin of `PlanVariantService::replace()` by design — assert, prepare
 * outside the transaction, `compareAndSwap` first inside it, audit after it —
 * because a client that has learned one plan sub-resource has learned all of
 * them. Three things differ, and each difference is an argument rather than an
 * oversight.
 *
 * ## 1. The lock is on the **item**, and the profile has none of its own
 *
 * `subscription_plan_profiles` deliberately carries no `lock_version`:
 * `PlanProfileService` says why — "it is not a separate thing to hold a lock
 * on, it is the commercial face of the item, and a concurrent editor of either
 * should lose the race with the other". A menu is a third face of the same
 * item, so `If-Match` carries the item's validator here too and the write bumps
 * it. Two merchandisers editing the matrix and the menu at once is a race one
 * of them should lose, and this is what makes them.
 *
 * ## 2. Absent entries are **deleted**, where absent matrix cells are archived
 *
 * The variant service archives because a variant is the priceable object: a
 * `price_list_items` row names it and an order line points at it, so removing
 * one would strand a price, and an archived cell keeps its coordinates occupied
 * for exactly that reason.
 *
 * None of that is true one table over. **Nothing references a
 * `plan_menu_entries` row.** No foreign key points at it, no price is quoted
 * against it, and generation copies the *dish* onto a `subscription_meal_choices`
 * row rather than the entry's identifier — so an order can be traced to what it
 * contained without the menu that suggested it still existing. The dish itself
 * is protected by its own `restrictOnDelete`, which means the one thing worth
 * protecting is already protected by the schema and does not need the service's
 * help.
 *
 * Archiving would also make the table's coordinate system worse rather than
 * safer: an archived entry would keep `(day, slot, sequence)` occupied, and
 * "Tuesday's lunch is the fish now" would become revive-and-repoint instead of
 * simply being stated. A menu is a statement about what the kitchen *will*
 * cook; what it *did* cook is recorded on the choice rows and the order lines,
 * and those are the rows that must survive. A menu that kept every dish it had
 * ever listed would be a history nobody asked it to keep, in the one place a
 * chef reads to find out what to make tomorrow.
 *
 * ## 3. The write is delete-all-then-insert, so a swap survives
 *
 * The same ordering the variant service uses and for the same reason: two
 * dishes trading places in one submission — Tuesday's lunch becomes Wednesday's
 * and Wednesday's becomes Tuesday's — would trip
 * `plan_menu_entries_one_per_slot` halfway through if the rows were updated in
 * place. Every entry for the plan is released before any is written, so no
 * intermediate state has two rows at one address. Here that falls out of
 * delete-not-archive for free rather than needing a separate release pass.
 *
 * ## The menu is one document: the cycle and the dishes move together
 *
 * `menu_cycle_days`, `menu_cycle_anchor_date` and the entries are submitted and
 * stored as a unit. Half of it is not a state this service will store:
 *
 *  * entries with no cycle length would have no modulus to resolve a date
 *    against — `cycleDayFor()` cannot answer "which day is Thursday" without
 *    one;
 *  * a cycle length with no entries is the worse half. `menu_cycle_days IS NOT
 *    NULL` is the signal every downstream reader takes to mean "this plan has a
 *    menu"; publishing it over an empty table would announce a menu whose every
 *    day is empty, which is a trap rather than a stage of setting one up.
 *
 * Submitting **no** entries and **no** cycle is therefore the one legal half-
 * state, because it is not a half-state at all: it is unpublishing the menu,
 * and it returns the plan to the behaviour every plan has today.
 *
 * ## The profile must already exist — this service does not create one
 *
 * `PlanProfileService` creates the profile on first write, deliberately, so
 * that "nobody has decided the terms" stays distinguishable from "somebody
 * chose the defaults" — the distinction the publish gate reads. A menu service
 * that quietly created a profile row would answer that question on the
 * kitchen's behalf, and it would answer it wrong: a menu on a plan whose
 * commercial terms nobody has written is a menu on nothing. So a missing
 * profile is `422 plan_profile_missing`, and the caller is told to write the
 * terms first.
 *
 * The refusal has **no carve-out for unpublishing**, and that is deliberate
 * too: this endpoint's whole job is writing two columns onto a profile row, and
 * a plan with no profile row has nothing to write them on. It cannot strand
 * anything either — the profile shares the item's primary key and cascades from
 * it, and there is no route that deletes one — so a plan with entries and no
 * profile is a state no writer can produce.
 */
final readonly class PlanMenuService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * @param  list<array{
     *     cycle_day: int|string,
     *     slot: string,
     *     sequence?: int|string|null,
     *     meal_catalogue_item_id: string
     * }>  $entries
     *
     * @throws ApiException
     */
    public function replace(
        CatalogueItem $item,
        array $entries,
        ?int $cycleDays,
        ?CarbonImmutable $anchorDate,
        int $expectedLockVersion,
    ): CatalogueItem {
        $this->assertPlan($item);
        $this->items->assertEditable($item);

        $prepared = $this->prepare($item, $entries, $cycleDays, $anchorDate);

        // Refused here rather than inside the transaction so that the ordinary
        // "you have not written the terms yet" does not cost the caller a
        // lock-version bump they would then have to re-read to recover from.
        $this->requireProfile($item);

        $removed = DB::transaction(function () use ($item, $prepared, $cycleDays, $anchorDate, $expectedLockVersion): int {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            // Every entry released before any is written: a submission that
            // swaps two days' dishes would otherwise trip the unique index
            // halfway through.
            $removed = PlanMenuEntry::withoutTenancy()->where('catalogue_item_id', $item->getKey())->delete();

            foreach ($prepared as $attributes) {
                $entry = new PlanMenuEntry;
                $entry->organisation_id = $item->organisation_id;
                $entry->catalogue_item_id = (string) $item->getKey();
                $entry->cycle_day = $attributes['cycle_day'];
                $entry->slot = $attributes['slot'];
                $entry->sequence = $attributes['sequence'];
                $entry->meal_catalogue_item_id = $attributes['meal_catalogue_item_id'];
                $entry->created_by = $this->context->userId();
                $entry->save();
            }

            // Re-read inside the transaction: the check above was for the
            // caller's benefit, this one is for correctness.
            $profile = $this->requireProfile($item);
            $profile->menu_cycle_days = $cycleDays;
            $profile->menu_cycle_anchor_date = $anchorDate;
            $profile->save();

            return $removed;
        });

        $this->audit->record(
            'catalogue.plan_menu_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['plan_menu', 'menu_cycle_days', 'menu_cycle_anchor_date'],
                'entry_count' => count($prepared),
                'removed_count' => $removed,
                'cycle_days' => $cycleDays,
                'anchor_date' => $anchorDate?->toDateString(),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * The stored menu, in the order a chef reads it: day, then sitting, then
     * the second lunch after the first.
     *
     * `slot` sorts by its position in the day rather than alphabetically —
     * `breakfast, dinner, lunch, snack` is not a day — which is why the order
     * is expressed as a CASE rather than left to the column.
     *
     * @return list<PlanMenuEntry>
     */
    public function entriesFor(CatalogueItem $item): array
    {
        return array_values(PlanMenuEntry::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->orderBy('cycle_day')
            ->orderByRaw("CASE slot WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END")
            ->orderBy('sequence')
            ->get()
            ->all());
    }

    /**
     * The dishes a set of entries names, keyed by identifier.
     *
     * A separate call rather than an eager load, because `entriesFor()` reads
     * `withoutTenancy()` and a relation loaded off it would silently re-apply
     * the ambient scope — which is fine until the day a caller with no tenant
     * context reads a menu and gets a page of nameless entries.
     *
     * @param  list<PlanMenuEntry>  $entries
     * @return array<string, CatalogueItem>
     */
    public function mealsFor(array $entries): array
    {
        $ids = array_values(array_unique(array_map(
            static fn (PlanMenuEntry $entry): string => $entry->meal_catalogue_item_id,
            $entries,
        )));

        if ($ids === []) {
            return [];
        }

        /** @var array<string, CatalogueItem> $meals */
        $meals = CatalogueItem::withoutTenancy()
            ->whereKey($ids)
            ->get()
            ->keyBy(static fn (CatalogueItem $meal): string => (string) $meal->getKey())
            ->all();

        return $meals;
    }

    /**
     * The plan's cycle configuration, or nulls when no menu is published.
     *
     * Served from the profile even when the profile does not exist, because a
     * plan with no terms and a plan with terms and no menu have the same menu —
     * none — and a reader asking "what is on this menu" should not have to
     * handle two shapes of nothing.
     *
     * @return array{cycle_days: int|null, anchor_date: string|null}
     */
    public function cycleFor(CatalogueItem $item): array
    {
        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->first();

        return [
            'cycle_days' => $profile?->menu_cycle_days,
            'anchor_date' => $profile?->menu_cycle_anchor_date?->toDateString(),
        ];
    }

    /**
     * Validate and normalise the submitted menu, **before** anything is
     * written.
     *
     * Everything here is a semantic rule the FormRequest cannot see: whether a
     * dish is this kitchen's, whether it is a meal, whether it is published,
     * and whether the day it sits on exists in the cycle it is submitted with.
     *
     * @param  list<array<string, mixed>>  $entries
     * @return list<array{cycle_day: int, slot: string, sequence: int, meal_catalogue_item_id: string}>
     *
     * @throws ApiException
     */
    private function prepare(CatalogueItem $item, array $entries, ?int $cycleDays, ?CarbonImmutable $anchorDate): array
    {
        $this->assertMenuIsWhole($entries, $cycleDays, $anchorDate);

        $prepared = [];

        /** @var array<string, int> $seen coordinate → the index that claimed it */
        $seen = [];

        foreach ($entries as $index => $entry) {
            $cycleDay = $this->positiveInt($entry['cycle_day'] ?? null, "entries.{$index}.cycle_day");
            $sequence = $this->sequence($entry['sequence'] ?? null, $index);
            $slot = $this->slot($entry['slot'] ?? null, $index);

            if ($cycleDays !== null && $cycleDay > $cycleDays) {
                throw $this->invalid(
                    "entries.{$index}.cycle_day",
                    'This plan runs a '.$cycleDays.'-day cycle, so there is no day '.$cycleDay.' to serve anything on. Lengthen the cycle or move the dish.',
                );
            }

            $coordinate = $cycleDay.'|'.$slot.'|'.$sequence;

            if (array_key_exists($coordinate, $seen)) {
                throw $this->invalid(
                    "entries.{$index}",
                    'This slot is filled twice in one submission. One day, one sitting and one sequence hold a single dish — two would be two lunches.',
                );
            }

            $seen[$coordinate] = $index;

            $prepared[] = [
                'cycle_day' => $cycleDay,
                'slot' => $slot,
                'sequence' => $sequence,
                'meal_catalogue_item_id' => (string) $this->usableMeal($item, $entry, $index)->getKey(),
            ];
        }

        return $prepared;
    }

    /**
     * The cycle and its dishes are one document — see the class docblock.
     *
     * @param  list<array<string, mixed>>  $entries
     *
     * @throws ApiException
     */
    private function assertMenuIsWhole(array $entries, ?int $cycleDays, ?CarbonImmutable $anchorDate): void
    {
        if ($cycleDays === null) {
            if ($entries !== []) {
                throw $this->invalid(
                    'menu_cycle_days',
                    'A menu needs a cycle length. Without one there is no way to say which day of the rotation a date falls on.',
                );
            }

            if ($anchorDate !== null) {
                throw $this->invalid(
                    'menu_cycle_anchor_date',
                    'An anchor date describes a cycle, and no cycle length was submitted. Send both to publish a menu, or neither to withdraw one.',
                );
            }

            return;
        }

        if ($anchorDate === null) {
            throw $this->invalid(
                'menu_cycle_anchor_date',
                'A cycle needs a date to start counting from. Day 1 of the menu falls on the anchor date.',
            );
        }

        if ($entries === []) {
            throw $this->invalid(
                'entries',
                'A cycle length with no dishes would publish a menu whose every day is empty. Send the dishes with it, or send nothing at all to withdraw the menu.',
            );
        }
    }

    /**
     * The dish: this kitchen's, a meal, and published.
     *
     * **Published** rather than merely existing, because a menu entry is a
     * promise to serve the thing: a draft is a dish nobody has finished
     * describing and a retired one is a dish the kitchen has stopped selling,
     * and generation would carry either onto a customer's delivery without ever
     * asking again.
     *
     * @param  array<string, mixed>  $entry
     *
     * @throws ApiException
     */
    private function usableMeal(CatalogueItem $item, array $entry, int $index): CatalogueItem
    {
        $id = $this->trimmedOrNull($entry['meal_catalogue_item_id'] ?? null);
        $field = "entries.{$index}.meal_catalogue_item_id";

        if ($id === null) {
            throw $this->invalid($field, 'A menu entry has to say which dish fills the slot.');
        }

        $meal = CatalogueItem::withoutTenancy()
            ->whereKey($id)
            ->where('organisation_id', $item->organisation_id)
            ->first();

        if (! $meal instanceof CatalogueItem) {
            throw $this->invalid($field, 'This dish does not exist, or is not one you can use.');
        }

        if ($meal->item_type !== CatalogueItemType::Meal) {
            throw $this->invalid(
                $field,
                'A menu serves meals. This catalogue item is a '.$meal->item_type->value.', and a plan cannot be a course of itself.',
            );
        }

        if ($meal->status !== CatalogueItemStatus::Published) {
            throw $this->invalid(
                $field,
                'This meal is '.$meal->status->value.', so it cannot be put on a menu. Publish it first — a menu entry is a promise to serve the dish.',
            );
        }

        return $meal;
    }

    /**
     * @throws ApiException
     */
    private function requireProfile(CatalogueItem $item): SubscriptionPlanProfile
    {
        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->first();

        if ($profile instanceof SubscriptionPlanProfile) {
            return $profile;
        }

        throw new ApiException(
            ErrorCode::ValidationFailed,
            'This plan has no commercial terms yet, so there is nothing for a menu to hang on. Write the profile first — a menu on an unconfigured plan is a menu on nothing.',
            [
                'fields' => ['item' => ['This plan has no profile. Write its terms before its menu.']],
                'reason' => 'plan_profile_missing',
            ],
        );
    }

    /**
     * @throws ApiException
     */
    private function slot(mixed $value, int $index): string
    {
        $slot = $this->trimmedOrNull($value);

        // The same four words `subscription_meal_choices` stores, checked here
        // as well as by the CHECK underneath: generation copies this string
        // straight onto a choice row, so a value this table would admit and
        // that one would not is a failure at the wrong end of the system.
        if ($slot !== null && in_array($slot, ['breakfast', 'lunch', 'dinner', 'snack'], true)) {
            return $slot;
        }

        throw $this->invalid(
            "entries.{$index}.slot",
            'A dish is served at breakfast, lunch, dinner or as a snack.',
        );
    }

    /**
     * @throws ApiException
     */
    private function sequence(mixed $value, int $index): int
    {
        if ($value === null || $value === '') {
            return 1;
        }

        return $this->positiveInt($value, "entries.{$index}.sequence");
    }

    /**
     * @throws ApiException
     */
    private function assertPlan(CatalogueItem $item): void
    {
        if ($item->item_type === CatalogueItemType::SubscriptionPlan) {
            return;
        }

        throw $this->invalid(
            'item',
            'Only a subscription plan has a menu. A product has packs; a meal is the thing a menu puts on the day.',
        );
    }

    /**
     * @throws ApiException
     */
    private function positiveInt(mixed $value, string $field): int
    {
        if (! is_numeric($value) || (int) $value <= 0) {
            throw $this->invalid($field, 'This must be a whole number greater than zero.');
        }

        return (int) $value;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
