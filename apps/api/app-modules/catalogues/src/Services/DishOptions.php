<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemOption;
use Illuminate\Support\Facades\DB;

/**
 * The free changes a dish offers: what it is, and what a line chose from it.
 *
 * Removing an ingredient changes the plate and **never the allergen statement**.
 * The kitchen may still cross-contact, so a line with "no peanuts" carries the
 * dish's allergens as they stand, and nothing here reads or writes them.
 *
 * A choice is different: a new sauce is a new thing on the plate. So adding or
 * renaming one clears a member of staff's stamp that the dish contains no
 * allergens, and {@see CatalogueItem::scopeAllergensAssessed()} takes it off sale
 * until somebody looks again. The stamp is all it can clear: a recipe or ingredient
 * list is not a statement anybody made about the new choice, and those still vouch
 * for the dish. A removal, a reorder or a deleted row clears nothing.
 *
 * @phpstan-type DishOption array{id: string, kind: string, group_en: string|null, group_ar: string|null, name_en: string, name_ar: string}
 */
final readonly class DishOptions
{
    /**
     * What makes two lines of one dish different lines: empty when they carry
     * nothing, so a plain line merges exactly as it always has.
     *
     * @param  list<string>  $optionIds
     */
    public static function lineKey(array $optionIds, ?string $note): string
    {
        $note = trim((string) $note);

        if ($optionIds === [] && $note === '') {
            return '';
        }

        sort($optionIds);

        return sha1(implode(',', $optionIds).'|'.$note);
    }

    /**
     * @return list<DishOption>
     */
    public function forItem(string $catalogueItemId): array
    {
        return array_values(CatalogueItemOption::withoutTenancy()
            ->where('catalogue_item_id', $catalogueItemId)
            ->orderBy('display_order')
            ->orderBy('id')
            ->get()
            ->map(fn (CatalogueItemOption $option): array => $this->shape($option))
            ->all());
    }

    /**
     * The chosen options as a line stores them, or null when one is not this
     * dish's (any more) or two come from one group.
     *
     * @param  list<string>  $optionIds
     * @return list<DishOption>|null
     */
    public function snapshot(string $catalogueItemId, array $optionIds): ?array
    {
        if ($optionIds === []) {
            return [];
        }

        $chosen = array_values(array_filter(
            $this->forItem($catalogueItemId),
            static fn (array $option): bool => in_array($option['id'], $optionIds, true),
        ));

        if (count($chosen) !== count(array_unique($optionIds))) {
            return null;
        }

        $groups = array_filter(array_column($chosen, 'group_en'));

        return count($groups) === count(array_unique($groups)) ? $chosen : null;
    }

    /**
     * The dish's whole list, as the editor sends it. A row that names its id keeps
     * it, so a basket holding that option still finds it after a rename. Clears
     * the allergen stamp on `$item` when a choice is added or renamed.
     *
     * @param  list<array{id?: string|null, kind: string, group_en?: string|null, group_ar?: string|null, name_en: string, name_ar: string}>  $rows
     * @return list<DishOption>
     */
    public function replace(CatalogueItem $item, array $rows): array
    {
        DB::transaction(function () use ($item, $rows): void {
            $kept = array_values(array_filter(array_column($rows, 'id')));
            $unreviewed = false;

            CatalogueItemOption::query()
                ->where('catalogue_item_id', $item->getKey())
                ->whereNotIn('id', $kept)
                ->delete();

            foreach ($rows as $order => $row) {
                $option = isset($row['id'])
                    ? CatalogueItemOption::query()->where('catalogue_item_id', $item->getKey())->whereKey($row['id'])->first()
                    : null;

                $option ??= new CatalogueItemOption;
                $choice = $row['kind'] === 'choice';

                $option->organisation_id = (string) $item->organisation_id;
                $option->catalogue_item_id = (string) $item->getKey();
                $option->kind = $row['kind'];
                $option->group_en = $choice ? ($row['group_en'] ?? null) : null;
                $option->group_ar = $choice ? ($row['group_ar'] ?? null) : null;
                $option->name_en = $row['name_en'];
                $option->name_ar = $row['name_ar'];
                $option->display_order = $order;

                $unreviewed = $unreviewed || ($choice && $option->isDirty(['kind', 'group_en', 'group_ar', 'name_en', 'name_ar']));

                $option->save();
            }

            if ($unreviewed && $item->allergens_assessed_at !== null) {
                $item->forceFill(['allergens_assessed_at' => null, 'allergens_assessed_by' => null])->save();
            }
        });

        return $this->forItem((string) $item->getKey());
    }

    /**
     * @return DishOption
     */
    private function shape(CatalogueItemOption $option): array
    {
        return [
            'id' => (string) $option->getKey(),
            'kind' => $option->kind,
            'group_en' => $option->group_en,
            'group_ar' => $option->group_ar,
            'name_en' => $option->name_en,
            'name_ar' => $option->name_ar,
        ];
    }
}
