<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

/**
 * The locale a public marketplace projection is served in, and the punctuation
 * that goes with it.
 *
 * Deliberately a fourth copy of the four-line `Accept-Language` parser the
 * allergen, diet and delivery-area presenters already carry, rather than a
 * shared utility they all reach for. The three existing copies each recorded
 * the same reason — reaching across a module boundary for a header parser buys
 * a dependency edge rather than removes a duplication — and this one is the
 * first that could legitimately be shared, because all three marketplace
 * presenters live in this module. It is one class here, used by all three, and
 * it does not reach outside the module either.
 *
 * Only the two languages the platform actually publishes are honoured; anything
 * else falls back to English rather than serving a half-empty shape.
 */
final class MarketplaceLocale
{
    public static function from(?string $acceptLanguage): string
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

    /**
     * Pick the column the locale names, falling back to the other when the one
     * asked for is empty.
     *
     * The fallback is what stops a half-translated row rendering as a blank
     * name. It is safe here and nowhere near a label: a catalogue item cannot
     * be *published* with an empty name in either language — the readiness
     * gate refuses it — so this only ever fires on a column no publication
     * path can produce, and showing the other language beats showing nothing.
     */
    public static function pick(string $locale, ?string $english, ?string $arabic): string
    {
        $wanted = $locale === 'ar' ? $arabic : $english;

        if ($wanted !== null && trim($wanted) !== '') {
            return $wanted;
        }

        $other = $locale === 'ar' ? $english : $arabic;

        return $other !== null && trim($other) !== '' ? $other : '';
    }

    /**
     * The list separator for the locale.
     *
     * Arabic uses the Arabic comma (U+060C); joining Arabic place names with a
     * Latin comma is the sort of detail that makes a translated screen read as
     * translated rather than as written.
     *
     * @param  list<string>  $values
     */
    public static function join(string $locale, array $values): string
    {
        return implode($locale === 'ar' ? '، ' : ', ', $values);
    }
}
