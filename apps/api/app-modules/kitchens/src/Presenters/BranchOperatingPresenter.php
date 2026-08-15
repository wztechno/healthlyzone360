<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

use Healthy360\Kitchens\Models\BranchOpeningHour;

/**
 * The wire shape of a branch's operating week.
 *
 * `is_open` is derived rather than stored, so a client has one field to branch
 * on and cannot be shown a flag that disagrees with the times beside it.
 *
 * Times are served as `HH:MM` — the shape a human wrote and a picker renders —
 * rather than the `HH:MM:SS` PostgreSQL returns.
 *
 * **Unconfigured days are absent from the collection, not filled in.** A week
 * with three rows means four days nobody has decided about, and inventing
 * `is_open: false` for them would tell a customer the branch is shut on
 * Thursday when the truth is that nobody has said. `meta.configured_weekdays`
 * and `meta.is_complete` let a client say so.
 */
final class BranchOperatingPresenter
{
    /**
     * @return array{
     *     id: string,
     *     branch_id: string,
     *     weekday: int,
     *     is_open: bool,
     *     opens_at: string|null,
     *     closes_at: string|null,
     *     order_cut_off_at: string|null
     * }
     */
    public function day(BranchOpeningHour $hours): array
    {
        return [
            'id' => (string) $hours->getKey(),
            'branch_id' => $hours->branch_id,
            'weekday' => $hours->weekday,
            'is_open' => $hours->isOpen(),
            'opens_at' => self::clock($hours->opens_at),
            'closes_at' => self::clock($hours->closes_at),
            'order_cut_off_at' => self::clock($hours->order_cut_off_at),
        ];
    }

    /**
     * @param  list<BranchOpeningHour>  $week
     * @return array{configured_weekdays: list<int>, open_day_count: int, is_complete: bool}
     */
    public function meta(array $week): array
    {
        $weekdays = array_map(static fn (BranchOpeningHour $day): int => $day->weekday, $week);

        return [
            'configured_weekdays' => $weekdays,
            'open_day_count' => count(array_filter($week, static fn (BranchOpeningHour $day): bool => $day->isOpen())),
            'is_complete' => count($weekdays) === 7,
        ];
    }

    /**
     * `HH:MM:SS` from PostgreSQL, `HH:MM` on the wire.
     */
    public static function clock(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return mb_substr($value, 0, 5);
    }
}
