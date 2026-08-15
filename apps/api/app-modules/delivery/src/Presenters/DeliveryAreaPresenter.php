<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Presenters;

use Healthy360\ReferenceData\Models\DeliveryArea;

/**
 * The wire shapes of a platform delivery area.
 *
 * `publicProjection()` carries **one** server-localised `name`, chosen from
 * `Accept-Language`, never both language columns (master plan v2 §4.8) — the
 * pattern the public allergen and diet lists established.
 *
 * It carries `region` too, and `region` is currently null on every row. That
 * is deliberate rather than an oversight worth hiding: OD-12 says the source
 * does not record which governorate a place belongs to, and a client that
 * wants to group the picker can see for itself that the platform has nothing
 * to group by. Omitting the field would make the gap invisible and would
 * change the shape the day somebody fills it in.
 *
 * `admin()` carries both language columns and `is_active`, because a kitchen
 * choosing areas for a zone needs to see the vocabulary in both languages and
 * needs to know that an area it already serves has been withdrawn.
 */
final class DeliveryAreaPresenter
{
    /**
     * @return array{
     *     id: string,
     *     country_code: string,
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     region: string|null,
     *     display_order: int,
     *     is_active: bool
     * }
     */
    public function admin(DeliveryArea $area): array
    {
        return [
            'id' => (string) $area->getKey(),
            'country_code' => $area->country_code,
            'code' => $area->code,
            'name_en' => $area->name_en,
            'name_ar' => $area->name_ar,
            'region' => $area->region,
            'display_order' => $area->display_order,
            'is_active' => $area->is_active,
        ];
    }

    /**
     * @return array{id: string, country_code: string, code: string, name: string, region: string|null, display_order: int}
     */
    public function publicProjection(DeliveryArea $area, string $locale): array
    {
        return [
            'id' => (string) $area->getKey(),
            'country_code' => $area->country_code,
            'code' => $area->code,
            'name' => $locale === 'ar' ? $area->name_ar : $area->name_en,
            'region' => $area->region,
            'display_order' => $area->display_order,
        ];
    }

    /**
     * The locale a public projection is served in.
     *
     * Only the two languages the platform actually publishes are honoured;
     * anything else falls back to English rather than serving a half-empty
     * shape. Deliberately a copy of the allergen and diet presenters' method
     * rather than a call into one of them: reaching across a module boundary
     * for a four-line header parser would buy a dependency edge rather than
     * remove a duplication.
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
