<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Allergens;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Ingredients\Nutrition\NutritionReferenceService;

final class AllergenReferenceMapper
{
    // An explicit crosswalk to our existing classes, not an imported taxonomy.
    private const array CODES = [
        'gluten' => 'gluten', 'wheat' => 'gluten', 'rye' => 'gluten', 'barley' => 'gluten', 'oats' => 'gluten',
        'crustaceans' => 'crustaceans', 'crustacean' => 'crustaceans', 'eggs' => 'egg', 'egg' => 'egg',
        'fish' => 'fish', 'peanuts' => 'peanut', 'peanut' => 'peanut', 'soybeans' => 'soy', 'soy' => 'soy', 'soya' => 'soy',
        'milk' => 'milk', 'nuts' => 'tree_nut', 'tree-nuts' => 'tree_nut', 'tree-nut' => 'tree_nut',
        'almonds' => 'tree_nut', 'hazelnuts' => 'tree_nut', 'walnuts' => 'tree_nut', 'cashews' => 'tree_nut',
        'pecans' => 'tree_nut', 'pistachios' => 'tree_nut', 'brazil-nuts' => 'tree_nut', 'macadamia-nuts' => 'tree_nut',
        'sesame-seeds' => 'sesame', 'sesame' => 'sesame', 'celery' => 'celery', 'mustard' => 'mustard',
        'sulphur-dioxide-and-sulphites' => 'sulphites', 'sulfites' => 'sulphites', 'sulphites' => 'sulphites',
        'lupin' => 'lupin', 'lupine' => 'lupin', 'molluscs' => 'mollusc', 'mollusks' => 'mollusc', 'mollusk' => 'mollusc',
    ];

    /** @param array<string, mixed> $record
     * @return array<string, mixed>
     */
    public function map(string $provider, array $record): array
    {
        $snapshot = array_intersect_key($record, array_flip(['code', 'product_name', 'brands', 'allergens_tags', 'traces_tags', 'last_modified_t']));
        $active = Allergen::query()->where('is_active', true)->pluck('code')->all();
        $mappings = [];
        $unmapped = [];
        $sets = ['contains' => $record['allergens_tags'] ?? [], 'may_contain' => $record['traces_tags'] ?? []];
        foreach ($sets as $containment => $tags) {
            foreach (is_array($tags) ? $tags : [] as $tag) {
                if (! is_string($tag)) {
                    continue;
                }
                $normal = str_replace('_', '-', strtolower(preg_replace('/^en:/', '', $tag) ?? $tag));
                $code = self::CODES[$normal] ?? null;
                if ($code === null || ! in_array($code, $active, true)) {
                    $unmapped[] = $tag;

                    continue;
                }
                if (isset($mappings[$code]) && $mappings[$code]['containment'] === 'contains') {
                    continue;
                }
                $mappings[$code] = ['allergen_code' => $code, 'containment' => $containment, 'source_tag' => $tag];
            }
        }
        ksort($mappings);
        $id = (string) ($record['code'] ?? '');
        $label = (string) ($record['product_name'] ?? '');
        $valid = preg_match('/^[0-9]{8,14}$/D', $id) === 1;

        return [
            'ref' => 'off:'.$id, 'provider' => $provider, 'label' => $label,
            'brand' => ($record['brands'] ?? null),
            'source_url' => 'https://world.openfoodfacts.org/product/'.$id,
            'attribution' => 'Open Food Facts — ODbL',
            'mappings' => array_values($mappings), 'unmapped_terms' => array_values(array_unique($unmapped)),
            'source_hash' => hash('sha256', json_encode(NutritionReferenceService::canonical(['mapping_version' => 1, 'source' => $snapshot, 'mappings' => $mappings, 'unmapped' => $unmapped]), JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION)),
            'retrieved_at' => now()->toIso8601String(), 'importable' => $valid && trim($label) !== '' && $mappings !== [],
            'selection_token' => null,
        ];
    }
}
