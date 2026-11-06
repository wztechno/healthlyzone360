<?php

declare(strict_types=1);

namespace Healthy360\Customers\Presenters;

use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;

/**
 * What a customer has said they eat — served back to them and to nobody else.
 *
 * Every field here is `SpecialCategory`, including the allergen code, which is
 * public reference data right up until it is attached to a person. Staff-facing
 * reads of the same table go through `DietaryProfileReader`, which demands a
 * purpose of use; this presenter has no such gate because it has no such need —
 * its only caller is the account holder's own `/me/dietary-profile`.
 *
 * **`has_declared` is the field that matters, and it is not `allergens === []`.**
 * An unanswered question and a confident "I have none" are different facts, and
 * only the second may activate an account that is about to be sent food. The
 * two are distinguishable on the wire because they are distinguishable in the
 * table: `declared_at` is a timestamp rather than a flag, and
 * `declares_no_allergens` is written by the act of declaring.
 *
 * A profile that has never been written is presented rather than created. A GET
 * that inserted a row would be a write on a read — untrue to the verb, and a
 * surprise on any deployment that ever puts a reader on a replica.
 */
final class DietaryProfilePresenter
{
    /**
     * @param  list<CustomerAllergenDeclaration>  $allergens
     * @param  list<CustomerFoodExclusion>  $exclusions
     * @return array{
     *     id: string|null,
     *     has_declared: bool,
     *     declared_at: string|null,
     *     declares_no_allergens: bool,
     *     diet_classification_id: string|null,
     *     diet_classification_code: string|null,
     *     religious_requirement: string|null,
     *     notes: string|null,
     *     allergens: list<array{allergen_code: string, severity: string, notes: string|null, declared_at: string|null}>,
     *     exclusions: list<array{id: string, kind: string, subject_kind: string, ingredient_id: string|null, ingredient_name: string|null, diet_classification_id: string|null, free_text: string|null}>,
     *     lock_version: int|null,
     *     updated_at: string|null
     * }
     */
    public function profile(?CustomerDietaryProfile $profile, array $allergens = [], array $exclusions = [], string $locale = 'en'): array
    {
        $names = $this->ingredientNames($exclusions, $locale);

        return [
            'id' => $profile === null ? null : (string) $profile->getKey(),
            'has_declared' => $profile?->hasDeclared() ?? false,
            'declared_at' => $profile?->declared_at?->toIso8601String(),
            // `->` rather than `?->` on the left of `??`: the coalesce already
            // suppresses a property read on null, and the nullsafe operator on
            // top of it is noise.
            'declares_no_allergens' => $profile->declares_no_allergens ?? false,
            'diet_classification_id' => $profile?->diet_classification_id,
            // The diet's vocabulary code beside its identifier: the code is what a
            // client holds and sends back, and the public diet list publishes no
            // identifiers to map one onto the other.
            'diet_classification_code' => $profile?->dietClassification?->code,
            'religious_requirement' => $profile?->religious_requirement,
            'notes' => $profile?->notes,
            'allergens' => array_map(fn (CustomerAllergenDeclaration $row): array => $this->allergen($row), $allergens),
            'exclusions' => array_map(
                fn (CustomerFoodExclusion $row): array => $this->exclusion($row, $row->ingredient_id === null ? null : ($names[$row->ingredient_id] ?? null)),
                $exclusions,
            ),
            'lock_version' => $profile?->lock_version,
            'updated_at' => $profile?->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The declaration carries no identifier of its own.
     *
     * The set is replaced whole on every write — a person removing an allergy
     * means they no longer have it, so a merge would make removal impossible —
     * which means a row identifier would be a handle onto something that does
     * not survive the next `PUT`, and a client that stored one would be holding
     * a stale reference by design. The allergen code is the identity that
     * matters.
     *
     * @return array{allergen_code: string, severity: string, notes: string|null, declared_at: string|null}
     */
    public function allergen(CustomerAllergenDeclaration $declaration): array
    {
        return [
            'allergen_code' => $declaration->allergen_code,
            'severity' => $declaration->severity->value,
            'notes' => $declaration->notes,
            'declared_at' => $declaration->declared_at->toIso8601String(),
        ];
    }

    /**
     * `subject_kind` says which of the three columns is the one to read, so a
     * client can render an exclusion without inspecting all three and guessing.
     *
     * `ingredient_name` is the ingredient's name in the caller's language, so a
     * saved exclusion can be shown as a word rather than an identifier. `null`
     * on the other two subject kinds.
     *
     * @return array{id: string, kind: string, subject_kind: string, ingredient_id: string|null, ingredient_name: string|null, diet_classification_id: string|null, free_text: string|null}
     */
    public function exclusion(CustomerFoodExclusion $exclusion, ?string $ingredientName = null): array
    {
        return [
            'id' => (string) $exclusion->getKey(),
            'kind' => $exclusion->kind->value,
            'subject_kind' => $exclusion->subjectKind(),
            'ingredient_id' => $exclusion->ingredient_id,
            'ingredient_name' => $ingredientName,
            'diet_classification_id' => $exclusion->diet_classification_id,
            'free_text' => $exclusion->free_text,
        ];
    }

    /**
     * The names of the ingredients these exclusions point at, in one query.
     *
     * Read past the tenant scope because the account holder has no tenant
     * context, and the ingredient may be a kitchen's own row — the ones the
     * customer ingredient search offers when a published meal lists them. The
     * only identifiers that reach here are ones this person saved, and an
     * ingredient identifier is a random UUID they could only have had from that
     * search; reading one name back is not a way into a kitchen's list.
     *
     * @param  list<CustomerFoodExclusion>  $exclusions
     * @return array<string, string>
     */
    private function ingredientNames(array $exclusions, string $locale): array
    {
        $ids = array_values(array_unique(array_filter(array_map(
            static fn (CustomerFoodExclusion $row): ?string => $row->ingredient_id,
            $exclusions,
        ))));

        if ($ids === []) {
            return [];
        }

        $names = [];

        foreach (Ingredient::withoutTenancy()->whereIn('id', $ids)->get(['id', 'name_en', 'name_ar']) as $ingredient) {
            $names[(string) $ingredient->getKey()] = MarketplaceLocale::pick($locale, $ingredient->name_en, $ingredient->name_ar);
        }

        return $names;
    }
}
