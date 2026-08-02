<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Presenters;

use Healthy360\Allergens\Models\Allergen;

/**
 * The wire shapes of an allergen class — two of them, deliberately.
 *
 * `admin()` carries both languages and every governance field, and ignores
 * `Accept-Language`: an editor working on the Arabic name must see the
 * English one beside it, and a translation surface that hides half the data
 * depending on a header is unusable (master plan v2 §4.18).
 *
 * `publicProjection()` carries **one** server-localised `name` and no
 * governance metadata beyond what a diner legitimately needs — this is the
 * only shape an anonymous caller ever receives (§4.8).
 */
final class AllergenClassPresenter
{
    /**
     * @return array{
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     description_en: string|null,
     *     description_ar: string|null,
     *     regulatory_ref: string,
     *     is_eu_14: bool,
     *     is_us_big_9: bool,
     *     us_declaration_required: bool,
     *     us_threshold_ppm: int|null,
     *     display_order: int,
     *     is_active: bool
     * }
     */
    public function admin(Allergen $allergen): array
    {
        return [
            'code' => $allergen->code,
            'name_en' => $allergen->name_en,
            'name_ar' => $allergen->name_ar,
            'description_en' => $allergen->description_en,
            'description_ar' => $allergen->description_ar,
            'regulatory_ref' => $allergen->regulatory_ref,
            'is_eu_14' => $allergen->is_eu_14,
            'is_us_big_9' => $allergen->is_us_big_9,
            'us_declaration_required' => $allergen->us_declaration_required,
            'us_threshold_ppm' => $allergen->us_threshold_ppm,
            'display_order' => $allergen->display_order,
            'is_active' => $allergen->is_active,
        ];
    }

    /**
     * @return array{
     *     code: string,
     *     name: string,
     *     description: string|null,
     *     regulatory_ref: string,
     *     is_eu_14: bool,
     *     is_us_big_9: bool,
     *     us_declaration_required: bool,
     *     us_threshold_ppm: int|null,
     *     display_order: int
     * }
     */
    public function publicProjection(Allergen $allergen, string $locale): array
    {
        $arabic = $locale === 'ar';

        return [
            'code' => $allergen->code,
            'name' => $arabic ? $allergen->name_ar : $allergen->name_en,
            'description' => $arabic ? $allergen->description_ar : $allergen->description_en,
            'regulatory_ref' => $allergen->regulatory_ref,
            'is_eu_14' => $allergen->is_eu_14,
            'is_us_big_9' => $allergen->is_us_big_9,
            'us_declaration_required' => $allergen->us_declaration_required,
            'us_threshold_ppm' => $allergen->us_threshold_ppm,
            'display_order' => $allergen->display_order,
        ];
    }

    /**
     * The locale a public projection is rendered in. Only `en` and `ar` are
     * served (French is deferred — OQ-007), and anything else falls back to
     * English rather than failing: a diner reading an allergen list must
     * never be shown an error page because of a header.
     */
    public static function locale(?string $acceptLanguage): string
    {
        if ($acceptLanguage === null) {
            return 'en';
        }

        foreach (explode(',', $acceptLanguage) as $entry) {
            $tag = strtolower(trim(explode(';', $entry)[0]));

            if ($tag === 'ar' || str_starts_with($tag, 'ar-')) {
                return 'ar';
            }

            if ($tag === 'en' || str_starts_with($tag, 'en-')) {
                return 'en';
            }
        }

        return 'en';
    }
}
