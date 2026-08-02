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
 */
class MeasurementUnitSeeder extends Seeder
{
    /**
     * @var list<array{code: string, dimension: string, unit_system: string, name_en: string, name_ar: string}>
     */
    private const array UNITS = [
        ['code' => 'g', 'dimension' => 'mass', 'unit_system' => 'metric', 'name_en' => 'Gram', 'name_ar' => 'غرام'],
        ['code' => 'mg', 'dimension' => 'mass', 'unit_system' => 'metric', 'name_en' => 'Milligram', 'name_ar' => 'مليغرام'],
        ['code' => 'kg', 'dimension' => 'mass', 'unit_system' => 'metric', 'name_en' => 'Kilogram', 'name_ar' => 'كيلوغرام'],
        ['code' => 'ml', 'dimension' => 'volume', 'unit_system' => 'metric', 'name_en' => 'Millilitre', 'name_ar' => 'مليلتر'],
        ['code' => 'l', 'dimension' => 'volume', 'unit_system' => 'metric', 'name_en' => 'Litre', 'name_ar' => 'لتر'],
        ['code' => 'cm', 'dimension' => 'length', 'unit_system' => 'metric', 'name_en' => 'Centimetre', 'name_ar' => 'سنتيمتر'],
        ['code' => 'm', 'dimension' => 'length', 'unit_system' => 'metric', 'name_en' => 'Metre', 'name_ar' => 'متر'],
        ['code' => 'kcal', 'dimension' => 'energy', 'unit_system' => 'clinical', 'name_en' => 'Kilocalorie', 'name_ar' => 'كيلوكالوري'],
        ['code' => 'kJ', 'dimension' => 'energy', 'unit_system' => 'clinical', 'name_en' => 'Kilojoule', 'name_ar' => 'كيلوجول'],
        ['code' => 'piece', 'dimension' => 'count', 'unit_system' => 'clinical', 'name_en' => 'Piece', 'name_ar' => 'قطعة'],
        ['code' => 'serving', 'dimension' => 'serving', 'unit_system' => 'clinical', 'name_en' => 'Serving', 'name_ar' => 'حصة'],
        ['code' => 'tsp', 'dimension' => 'volume', 'unit_system' => 'imperial', 'name_en' => 'Teaspoon', 'name_ar' => 'ملعقة صغيرة'],
        ['code' => 'tbsp', 'dimension' => 'volume', 'unit_system' => 'imperial', 'name_en' => 'Tablespoon', 'name_ar' => 'ملعقة كبيرة'],
        ['code' => 'cup', 'dimension' => 'volume', 'unit_system' => 'imperial', 'name_en' => 'Cup', 'name_ar' => 'كوب'],
        ['code' => 'gallon', 'dimension' => 'volume', 'unit_system' => 'imperial', 'name_en' => 'Gallon', 'name_ar' => 'غالون'],

        // Pack units. A "can" is not a volume: how much is in it depends on
        // the product, so the equivalence lives on that product's pack
        // variant (master plan v2 §4.5) and never on the unit itself.
        ['code' => 'bunch', 'dimension' => 'package', 'unit_system' => 'packaging', 'name_en' => 'Bunch', 'name_ar' => 'باقة'],
        ['code' => 'can', 'dimension' => 'package', 'unit_system' => 'packaging', 'name_en' => 'Can', 'name_ar' => 'علبة'],
        ['code' => 'bag', 'dimension' => 'package', 'unit_system' => 'packaging', 'name_en' => 'Bag', 'name_ar' => 'كيس'],
        ['code' => 'bottle', 'dimension' => 'package', 'unit_system' => 'packaging', 'name_en' => 'Bottle', 'name_ar' => 'زجاجة'],
    ];

    public function run(): void
    {
        foreach (self::UNITS as $unit) {
            MeasurementUnit::query()->updateOrCreate(
                ['code' => $unit['code']],
                [
                    'dimension' => $unit['dimension'],
                    'unit_system' => $unit['unit_system'],
                    'name_en' => $unit['name_en'],
                    'name_ar' => $unit['name_ar'],
                    'is_active' => true,
                ],
            );
        }
    }
}
