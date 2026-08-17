<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;

/**
 * The administrative wire shapes of the subscription-plan family.
 *
 * Both names are always carried and `Accept-Language` is ignored for them, for
 * `CatalogueItemAdminPresenter`'s reason: a bilingual editor has to see what it
 * is editing (§4.18).
 *
 * **`duration_days` is served as `null` for a one-off, never as `0`.** The
 * sentinel was removed from the schema (§4.3) and re-introducing it on the wire
 * would hand every client the convention the migration exists to delete.
 * `duration_kind` is served beside it so a client branches on the kind rather
 * than on the nullability.
 *
 * **`discount_percent` is served as `null` when nobody has stated one**, and as
 * a decimal string otherwise. Not a float, for the reason no money in this
 * system is a float, and not `"0.00"` as a stand-in for absence: a client
 * rendering "0% off" where the truth is "nobody has told us" is the small,
 * quiet lie this programme keeps refusing to tell.
 *
 * **No money anywhere.** There is no amount on any shape here. What a plan
 * costs is a `price_list_items` row against the same variant, behind
 * `price_list.view_organisation` — and the publish gate's price check reaches
 * it through a port that answers only "priced or not", so nothing on this
 * surface can become a way around that permission.
 */
final class PlanAdminPresenter
{
    /**
     * @return array{
     *     id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     includes_breakfast: bool,
     *     includes_lunch: bool,
     *     includes_dinner: bool,
     *     meals_per_day: int,
     *     display_order: int,
     *     is_active: bool,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function combination(MealCombinationOption $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'code' => $row->code,
            'name_en' => $row->name_en,
            'name_ar' => $row->name_ar,
            'includes_breakfast' => $row->includes_breakfast,
            'includes_lunch' => $row->includes_lunch,
            'includes_dinner' => $row->includes_dinner,
            'meals_per_day' => $row->meals_per_day,
            'display_order' => $row->display_order,
            'is_active' => $row->is_active,
            'created_at' => $row->created_at?->toIso8601String(),
            'updated_at' => $row->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     min_kcal: int,
     *     max_kcal: int,
     *     display_order: int,
     *     is_active: bool,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function energyBand(EnergyBand $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'code' => $row->code,
            'name_en' => $row->name_en,
            'name_ar' => $row->name_ar,
            'min_kcal' => $row->min_kcal,
            'max_kcal' => $row->max_kcal,
            'display_order' => $row->display_order,
            'is_active' => $row->is_active,
            'created_at' => $row->created_at?->toIso8601String(),
            'updated_at' => $row->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     code: string,
     *     duration_kind: string,
     *     duration_days: int|null,
     *     name_en: string,
     *     name_ar: string,
     *     display_order: int,
     *     is_active: bool,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function duration(PlanDuration $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'code' => $row->code,
            'duration_kind' => $row->duration_kind->value,
            'duration_days' => $row->duration_days,
            'name_en' => $row->name_en,
            'name_ar' => $row->name_ar,
            'display_order' => $row->display_order,
            'is_active' => $row->is_active,
            'created_at' => $row->created_at?->toIso8601String(),
            'updated_at' => $row->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     catalogue_item_id: string,
     *     plan_type: string,
     *     pricing_basis: string,
     *     allows_free_selection: bool,
     *     skip_allowed: bool,
     *     pause_allowed: bool,
     *     change_cutoff_hours: int,
     *     summary_en: string|null,
     *     summary_ar: string|null,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function profile(SubscriptionPlanProfile $profile): array
    {
        return [
            'catalogue_item_id' => (string) $profile->getKey(),
            'plan_type' => $profile->plan_type->value,
            'pricing_basis' => $profile->pricing_basis->value,
            'allows_free_selection' => $profile->allows_free_selection,
            'skip_allowed' => $profile->skip_allowed,
            'pause_allowed' => $profile->pause_allowed,
            'change_cutoff_hours' => $profile->change_cutoff_hours,
            'summary_en' => $profile->summary_en,
            'summary_ar' => $profile->summary_ar,
            'created_at' => $profile->created_at?->toIso8601String(),
            'updated_at' => $profile->updated_at?->toIso8601String(),
        ];
    }

    /**
     * One matrix cell: its coordinates and the variant that carries them.
     *
     * The variant's `code` and `status` travel with the cell rather than in a
     * parallel list, because they are what the *next* call needs — a price
     * names the code, and an archived cell has to be visibly archived rather
     * than merely missing from a grid.
     *
     * @return array{
     *     catalogue_item_variant_id: string,
     *     code: string,
     *     status: string,
     *     name_en: string|null,
     *     name_ar: string|null,
     *     meal_combination_option_id: string,
     *     energy_band_id: string|null,
     *     service_tier: string,
     *     includes_snacks: bool,
     *     meals_per_day: int,
     *     snacks_per_day: int
     * }
     */
    public function cell(PlanVariantProfile $profile, CatalogueItemVariant $variant): array
    {
        return [
            'catalogue_item_variant_id' => (string) $variant->getKey(),
            'code' => $variant->code,
            'status' => $variant->status->value,
            'name_en' => $variant->name_en,
            'name_ar' => $variant->name_ar,
            'meal_combination_option_id' => $profile->meal_combination_option_id,
            'energy_band_id' => $profile->energy_band_id,
            'service_tier' => $profile->service_tier->value,
            'includes_snacks' => $profile->includes_snacks,
            'meals_per_day' => $profile->meals_per_day,
            'snacks_per_day' => $profile->snacks_per_day,
        ];
    }

    /**
     * One dish on one day of a plan's cycle.
     *
     * The dish's own name travels with the entry rather than being left to a
     * second call: the editor this feeds renders a week of slots, and a client
     * that had to resolve forty identifiers against the item list to draw one
     * screen would resolve them badly. It is `null` only if the meal has been
     * deleted underneath the row, which `restrictOnDelete` forbids — the
     * nullability is the presenter admitting it did not load the relation
     * rather than a state that can exist.
     *
     * @return array{
     *     id: string,
     *     cycle_day: int,
     *     slot: string,
     *     sequence: int,
     *     meal_catalogue_item_id: string,
     *     meal_name_en: string|null,
     *     meal_name_ar: string|null
     * }
     */
    public function menuEntry(PlanMenuEntry $entry, ?CatalogueItem $meal = null): array
    {
        return [
            'id' => (string) $entry->getKey(),
            'cycle_day' => $entry->cycle_day,
            'slot' => $entry->slot,
            'sequence' => $entry->sequence,
            'meal_catalogue_item_id' => $entry->meal_catalogue_item_id,
            'meal_name_en' => $meal?->name_en,
            'meal_name_ar' => $meal?->name_ar,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     catalogue_item_variant_id: string,
     *     variant_code: string|null,
     *     plan_duration_id: string,
     *     discount_percent: string|null,
     *     is_available: bool
     * }
     */
    public function durationAssignment(PlanVariantDuration $row, ?CatalogueItemVariant $variant = null): array
    {
        return [
            'id' => (string) $row->getKey(),
            'catalogue_item_variant_id' => $row->catalogue_item_variant_id,
            'variant_code' => $variant?->code,
            'plan_duration_id' => $row->plan_duration_id,

            // NULL stays NULL. See the class docblock: this is the field the
            // whole "discount unknown" decision hangs on.
            'discount_percent' => $row->discount_percent,
            'is_available' => $row->is_available,
        ];
    }
}
