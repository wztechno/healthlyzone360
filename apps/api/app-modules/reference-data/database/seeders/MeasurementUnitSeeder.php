<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Seeder;

/**
 * The measurement units the foundation needs before any nutrition or
 * clinical module exists.
 *
 * unit_system uses the three values allowed by the foundation ERD:
 * `metric` for SI mass, volume and length; `clinical` for the nutrition and
 * portion units (energy, pieces, servings); `imperial` for the US customary
 * kitchen measures.
 */
class MeasurementUnitSeeder extends Seeder
{
    /**
     * @var list<array{code: string, unit_system: string, name_en: string, name_ar: string}>
     */
    private const array UNITS = [
        ['code' => 'g', 'unit_system' => 'metric', 'name_en' => 'Gram', 'name_ar' => 'غرام'],
        ['code' => 'mg', 'unit_system' => 'metric', 'name_en' => 'Milligram', 'name_ar' => 'مليغرام'],
        ['code' => 'kg', 'unit_system' => 'metric', 'name_en' => 'Kilogram', 'name_ar' => 'كيلوغرام'],
        ['code' => 'ml', 'unit_system' => 'metric', 'name_en' => 'Millilitre', 'name_ar' => 'مليلتر'],
        ['code' => 'l', 'unit_system' => 'metric', 'name_en' => 'Litre', 'name_ar' => 'لتر'],
        ['code' => 'cm', 'unit_system' => 'metric', 'name_en' => 'Centimetre', 'name_ar' => 'سنتيمتر'],
        ['code' => 'm', 'unit_system' => 'metric', 'name_en' => 'Metre', 'name_ar' => 'متر'],
        ['code' => 'kcal', 'unit_system' => 'clinical', 'name_en' => 'Kilocalorie', 'name_ar' => 'كيلوكالوري'],
        ['code' => 'kJ', 'unit_system' => 'clinical', 'name_en' => 'Kilojoule', 'name_ar' => 'كيلوجول'],
        ['code' => 'piece', 'unit_system' => 'clinical', 'name_en' => 'Piece', 'name_ar' => 'قطعة'],
        ['code' => 'serving', 'unit_system' => 'clinical', 'name_en' => 'Serving', 'name_ar' => 'حصة'],
        ['code' => 'tsp', 'unit_system' => 'imperial', 'name_en' => 'Teaspoon', 'name_ar' => 'ملعقة صغيرة'],
        ['code' => 'tbsp', 'unit_system' => 'imperial', 'name_en' => 'Tablespoon', 'name_ar' => 'ملعقة كبيرة'],
        ['code' => 'cup', 'unit_system' => 'imperial', 'name_en' => 'Cup', 'name_ar' => 'كوب'],
    ];

    public function run(): void
    {
        foreach (self::UNITS as $unit) {
            MeasurementUnit::query()->updateOrCreate(
                ['code' => $unit['code']],
                [
                    'unit_system' => $unit['unit_system'],
                    'name_en' => $unit['name_en'],
                    'name_ar' => $unit['name_ar'],
                    'is_active' => true,
                ],
            );
        }
    }
}
