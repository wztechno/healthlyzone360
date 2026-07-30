<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use Healthy360\ReferenceData\Models\Language;
use Illuminate\Database\Seeder;

/**
 * ISO 639-1 languages. English and Arabic are the launch languages (plan §2);
 * French is seeded inactive as the first candidate for a later market.
 */
class LanguageSeeder extends Seeder
{
    /**
     * @var list<array{code: string, name_en: string, name_native: string, direction: string, is_active: bool}>
     */
    private const array LANGUAGES = [
        ['code' => 'en', 'name_en' => 'English', 'name_native' => 'English', 'direction' => 'ltr', 'is_active' => true],
        ['code' => 'ar', 'name_en' => 'Arabic', 'name_native' => 'العربية', 'direction' => 'rtl', 'is_active' => true],
        ['code' => 'fr', 'name_en' => 'French', 'name_native' => 'Français', 'direction' => 'ltr', 'is_active' => false],
    ];

    public function run(): void
    {
        Language::query()->upsert(
            self::LANGUAGES,
            ['code'],
            ['name_en', 'name_native', 'direction', 'is_active'],
        );
    }
}
