<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Seeder;

/**
 * The measurement units the foundation and the kitchen catalogue need.
 *
 * `unit_system` says where a unit comes from: `metric` for SI mass, volume
 * and length; `clinical` for the nutrition and portion units (energy, pieces,
 * servings); `imperial` for US customary kitchen measures; `packaging` for
 * the retail and wholesale pack units a purchase order is written in, which
 * belong to no measurement system at all.
 *
 * `dimension` says what a unit measures, and is what makes automatic
 * conversion safe (master plan v2 §4.5): grams convert to kilograms, and
 * nothing converts a bunch into a litre. Two dimensions beyond the plan's
 * five are carried because the seeded units genuinely need them — `energy`
 * for kcal/kJ and `length` for cm/m — and forcing either into `count` would
 * have made the conversion rule quietly wrong.
 *
 * `base_ratio` (INV1.0) is the factor to the dimension's canonical base —
 * **mass = gram**, **volume = millilitre** — so `UnitConversionService` can
 * convert within a dimension by pure arithmetic. Only mass and volume carry
 * real factors; `count`, `serving`, `package`, `energy` and `length` carry an
 * honest identity 1 and never cross-convert, so the number is not a claim that
 * a bunch equals a can. The spoon, cup and gallon volumes are APPROXIMATE
 * culinary conventions (flagged in the column comment), not exact definitions.
 */
class MeasurementUnitSeeder extends Seeder
{
    /**
     * @var list<array{code: string, dimension: string, unit_system: string, base_ratio: string, name_en: string, name_ar: string}>
     */
    private const array UNITS = [
        ['code' => 'g', 'dimension' => 'mass', 'unit_system' => 'metric', 'base_ratio' => '1', 'name_en' => 'Gram', 'name_ar' => 'غرام'],
        ['code' => 'mg', 'dimension' => 'mass', 'unit_system' => 'metric', 'base_ratio' => '0.001', 'name_en' => 'Milligram', 'name_ar' => 'مليغرام'],
        ['code' => 'kg', 'dimension' => 'mass', 'unit_system' => 'metric', 'base_ratio' => '1000', 'name_en' => 'Kilogram', 'name_ar' => 'كيلوغرام'],
        ['code' => 'ml', 'dimension' => 'volume', 'unit_system' => 'metric', 'base_ratio' => '1', 'name_en' => 'Millilitre', 'name_ar' => 'مليلتر'],
        ['code' => 'l', 'dimension' => 'volume', 'unit_system' => 'metric', 'base_ratio' => '1000', 'name_en' => 'Litre', 'name_ar' => 'لتر'],
        ['code' => 'cm', 'dimension' => 'length', 'unit_system' => 'metric', 'base_ratio' => '1', 'name_en' => 'Centimetre', 'name_ar' => 'سنتيمتر'],
        ['code' => 'm', 'dimension' => 'length', 'unit_system' => 'metric', 'base_ratio' => '1', 'name_en' => 'Metre', 'name_ar' => 'متر'],
        ['code' => 'kcal', 'dimension' => 'energy', 'unit_system' => 'clinical', 'base_ratio' => '1', 'name_en' => 'Kilocalorie', 'name_ar' => 'كيلوكالوري'],
        ['code' => 'kJ', 'dimension' => 'energy', 'unit_system' => 'clinical', 'base_ratio' => '1', 'name_en' => 'Kilojoule', 'name_ar' => 'كيلوجول'],
        ['code' => 'piece', 'dimension' => 'count', 'unit_system' => 'clinical', 'base_ratio' => '1', 'name_en' => 'Piece', 'name_ar' => 'قطعة'],
        ['code' => 'serving', 'dimension' => 'serving', 'unit_system' => 'clinical', 'base_ratio' => '1', 'name_en' => 'Serving', 'name_ar' => 'حصة'],
        ['code' => 'tsp', 'dimension' => 'volume', 'unit_system' => 'imperial', 'base_ratio' => '5', 'name_en' => 'Teaspoon', 'name_ar' => 'ملعقة صغيرة'],
        ['code' => 'tbsp', 'dimension' => 'volume', 'unit_system' => 'imperial', 'base_ratio' => '15', 'name_en' => 'Tablespoon', 'name_ar' => 'ملعقة كبيرة'],
        ['code' => 'cup', 'dimension' => 'volume', 'unit_system' => 'imperial', 'base_ratio' => '240', 'name_en' => 'Cup', 'name_ar' => 'كوب'],
        ['code' => 'gallon', 'dimension' => 'volume', 'unit_system' => 'imperial', 'base_ratio' => '3785.411784', 'name_en' => 'Gallon', 'name_ar' => 'غالون'],

        // Pack units. A "can" is not a volume: how much is in it depends on
        // the product, so the equivalence lives on that product's pack
        // variant (master plan v2 §4.5) and never on the unit itself. Their
        // `base_ratio` is an honest identity 1 — a package never cross-converts.
        ['code' => 'bunch', 'dimension' => 'package', 'unit_system' => 'packaging', 'base_ratio' => '1', 'name_en' => 'Bunch', 'name_ar' => 'باقة'],
        ['code' => 'can', 'dimension' => 'package', 'unit_system' => 'packaging', 'base_ratio' => '1', 'name_en' => 'Can', 'name_ar' => 'علبة'],
        ['code' => 'bag', 'dimension' => 'package', 'unit_system' => 'packaging', 'base_ratio' => '1', 'name_en' => 'Bag', 'name_ar' => 'كيس'],
        ['code' => 'bottle', 'dimension' => 'package', 'unit_system' => 'packaging', 'base_ratio' => '1', 'name_en' => 'Bottle', 'name_ar' => 'زجاجة'],
        ['code' => 'pack', 'dimension' => 'package', 'unit_system' => 'packaging', 'base_ratio' => '1', 'name_en' => 'Pack', 'name_ar' => 'عبوة'],
    ];

    public function run(): void
    {
        foreach (self::UNITS as $unit) {
            MeasurementUnit::query()->updateOrCreate(
                ['code' => $unit['code']],
                [
                    'dimension' => $unit['dimension'],
                    'unit_system' => $unit['unit_system'],
                    'base_ratio' => $unit['base_ratio'],
                    'name_en' => $unit['name_en'],
                    'name_ar' => $unit['name_ar'],
                    'is_active' => true,
                ],
            );
        }
    }
}
