<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Presenters;

/**
 * The locale a subscription's names are served in.
 *
 * A fifth copy of the four-line `Accept-Language` parser, and copied for the
 * reason the fourth one recorded: reaching across a module boundary for a
 * header parser buys a dependency edge rather than removes a duplication.
 * `Kitchens\Presenters\MarketplaceLocale` is the sibling; this module owns its
 * own so that the subscriptions surface does not acquire an edge to the
 * marketplace for a `strtolower`.
 *
 * **Why one name and not the pair.** `OrderPresenter` serves `area_name_en` and
 * `area_name_ar` together on an authenticated customer surface, and that is
 * defensible for an address the customer typed. A *plan* name is catalogue
 * copy: the kitchen wrote it twice so the platform could choose, and a client
 * that received both would be reimplementing this choice — badly, because it
 * does not know the fallback rule. One name, chosen where the header is.
 */
final class SubscriptionLocale
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
     * name on the screen where somebody is cancelling something.
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
}
