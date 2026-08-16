<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of a plan's fixed menu.
 *
 * `entries` is `present`, not `required`, for `ReplacePlanVariantsRequest`'s
 * reason: an empty array is the legitimate statement "this plan has no menu",
 * which withdraws the one it had, and `required` would reject it as if the
 * field had been forgotten. The two cycle fields are `present` and `nullable`
 * for the same reason one level up — the menu is one document, and a client
 * that omitted the cycle while sending dishes would be stating half of it by
 * accident rather than on purpose.
 *
 * `catalogue_item_id` is not a field: the plan is in the URL, and a body that
 * could disagree with it would eventually be made to.
 *
 * Everything here is **shape**. Whether a dish is this kitchen's, whether it is
 * a meal at all, whether it is published, and whether the day it sits on exists
 * in the submitted cycle are semantics, and they belong to
 * `PlanMenuService::prepare()` where the item is loaded — the same split every
 * other replace surface in this module makes.
 *
 * The caps are the cycle's: a `cycle_day` above 366 is not a rotation, and 400
 * entries covers a full year of a four-slot day with room for the kitchen that
 * serves lunch twice.
 */
class ReplacePlanMenuRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'entries' => ['present', 'array', 'max:400'],
            'entries.*.cycle_day' => ['required', 'integer', 'gt:0', 'max:366'],
            'entries.*.slot' => ['required', 'string', 'in:breakfast,lunch,dinner,snack'],
            'entries.*.sequence' => ['nullable', 'integer', 'gt:0', 'max:12'],
            'entries.*.meal_catalogue_item_id' => ['required', 'uuid'],

            'menu_cycle_days' => ['present', 'nullable', 'integer', 'gt:0', 'max:366'],
            'menu_cycle_anchor_date' => ['present', 'nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @return list<array{
     *     cycle_day: int|string,
     *     slot: string,
     *     sequence?: int|string|null,
     *     meal_catalogue_item_id: string
     * }>
     */
    public function entries(): array
    {
        /** @var list<array{cycle_day: int|string, slot: string, sequence?: int|string|null, meal_catalogue_item_id: string}> $entries */
        $entries = $this->validated('entries') ?? [];

        return $entries;
    }

    public function cycleDays(): ?int
    {
        $value = $this->validated('menu_cycle_days');

        return is_numeric($value) ? (int) $value : null;
    }

    /**
     * The anchor as a plain day.
     *
     * `startOfDay()` because the column is a `date` and the cycle turns over at
     * the kitchen's midnight — carrying a time through would put a timezone
     * question into an answer that does not have one.
     */
    public function anchorDate(): ?CarbonImmutable
    {
        $value = $this->validated('menu_cycle_anchor_date');

        return is_string($value) && $value !== ''
            ? CarbonImmutable::parse($value)->startOfDay()
            : null;
    }
}
