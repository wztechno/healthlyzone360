<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

/**
 * The sittings one plan day is made of — which meals a subscriber fills.
 *
 * A configuration says *how many* (`meals_per_day`, `snacks_per_day`); the
 * customer chooses a dish for each sitting, so the count has to become named
 * places a dish can go. The meals are dealt the way a day runs — one meal is
 * lunch, two are lunch and dinner, three are the whole day — and a fourth meal
 * has no sitting of its own, so it is a second lunch (sequence 2). Every snack
 * is a `snack`, numbered in order.
 *
 * One rule, read everywhere a day's shape matters: the storefront draws the
 * pickers from it, creation and `PUT …/choices` refuse a day that does not
 * fill it, and the desk calendar counts food by it.
 */
final class PlanSittings
{
    public const array SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

    /**
     * @return list<array{slot: string, sequence: int}>
     */
    public static function for(?int $mealsPerDay, ?int $snacksPerDay): array
    {
        $meals = max(0, $mealsPerDay ?? 0);
        $snacks = max(0, $snacksPerDay ?? 0);

        $slots = match (true) {
            $meals === 0 => [],
            $meals === 1 => ['lunch'],
            $meals === 2 => ['lunch', 'dinner'],
            default => ['breakfast', 'lunch', 'dinner', ...array_fill(0, $meals - 3, 'lunch')],
        };

        $slots = [...$slots, ...array_fill(0, $snacks, 'snack')];

        $sittings = [];
        $seen = [];

        foreach ($slots as $slot) {
            $seen[$slot] = ($seen[$slot] ?? 0) + 1;
            $sittings[] = ['slot' => $slot, 'sequence' => $seen[$slot]];
        }

        usort($sittings, static fn (array $left, array $right): int => [array_search($left['slot'], self::SLOTS, true), $left['sequence']]
            <=> [array_search($right['slot'], self::SLOTS, true), $right['sequence']]);

        return $sittings;
    }

    /**
     * The `slot:sequence` keys of a day, for comparing what was sent with what
     * the day needs.
     *
     * @param  list<array{slot: string, sequence: int}>  $sittings
     * @return list<string>
     */
    public static function keys(array $sittings): array
    {
        return array_map(static fn (array $sitting): string => $sitting['slot'].':'.$sitting['sequence'], $sittings);
    }
}
