<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Presenters;

use Healthy360\ReferenceData\Models\DietClassification;

/**
 * The wire shapes of a diet classification.
 *
 * `publicProjection()` carries **one** server-localised `name`, chosen from
 * `Accept-Language`, never both language columns (master plan v2 §4.8) — the
 * pattern `AllergenClassPresenter` established for the public allergen list,
 * followed rather than reinvented.
 *
 * `admin()` carries both, because a kitchen tagging an item needs to see the
 * vocabulary in both languages to know which value it is picking.
 */
final class DietClassificationPresenter
{
    /**
     * @return array{code: string, name_en: string, name_ar: string, display_order: int, is_active: bool}
     */
    public function admin(DietClassification $classification): array
    {
        return [
            'code' => $classification->code,
            'name_en' => $classification->name_en,
            'name_ar' => $classification->name_ar,
            'display_order' => $classification->display_order,
            'is_active' => $classification->is_active,
        ];
    }

    /**
     * @return array{code: string, name: string, display_order: int}
     */
    public function publicProjection(DietClassification $classification, string $locale): array
    {
        return [
            'code' => $classification->code,
            'name' => $locale === 'ar' ? $classification->name_ar : $classification->name_en,
            'display_order' => $classification->display_order,
        ];
    }

    /**
     * The locale a public projection is served in.
     *
     * Only the two languages the platform actually publishes are honoured;
     * anything else falls back to English rather than serving a half-empty
     * shape. Deliberately a copy of `AllergenClassPresenter::locale()` rather
     * than a call into it: one module reaching into another's presenter for a
     * header parser would be a dependency edge bought for four lines.
     */
    public static function locale(?string $acceptLanguage): string
    {
        if ($acceptLanguage === null) {
            return 'en';
        }

        foreach (explode(',', $acceptLanguage) as $entry) {
            $tag = strtolower(trim(explode(';', $entry, 2)[0]));

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
