<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for replacing a branch's operating week.
 *
 * `days` is `present`, not `required`: an empty array clears the week back to
 * unconfigured, which is a real thing to want when a schedule was entered
 * against the wrong branch.
 *
 * There is **no `branch_id`** in the body, deliberately. The branch comes from
 * `X-Branch-Id` through the `branch.context` middleware, which validates it
 * against the caller's membership scope; a second way to name a branch would
 * be an unvalidated one, and the two would eventually disagree.
 *
 * The per-row rules — both times or neither, close after open, no cut-off on a
 * closed day — are the service's, because each is a statement about the day as
 * a whole and the message has to say which day and which half.
 */
class ReplaceBranchOperatingRequest extends FormRequest
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
            'days' => ['present', 'array', 'max:7'],
            'days.*.weekday' => ['required', 'integer', 'between:1,7'],
            'days.*.opens_at' => ['nullable', 'date_format:H:i,H:i:s'],
            'days.*.closes_at' => ['nullable', 'date_format:H:i,H:i:s'],
            'days.*.order_cut_off_at' => ['nullable', 'date_format:H:i,H:i:s'],
        ];
    }

    /**
     * @return list<array{weekday: int, opens_at?: string|null, closes_at?: string|null, order_cut_off_at?: string|null}>
     */
    public function days(): array
    {
        /** @var list<array{weekday: int, opens_at?: string|null, closes_at?: string|null, order_cut_off_at?: string|null}> $days */
        $days = $this->validated('days') ?? [];

        return $days;
    }
}
