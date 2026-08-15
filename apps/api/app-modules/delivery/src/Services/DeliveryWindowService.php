<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * The named delivery slots a kitchen offers.
 *
 * A vocabulary, and it behaves like the plan vocabularies K1.6 introduced:
 * `code` is immutable, there is no DELETE, and withdrawal is `is_active =
 * false`. The reason there is no delete is the ordinary one — an order placed
 * for the evening slot has to stay explainable — and it applies before orders
 * exist because the alternative is introducing a delete and taking it away
 * again.
 *
 * **`weekdays: []` means every day.** The service normalises to that: a caller
 * that sends all seven gets `[]` back, because "Monday through Sunday" and "no
 * restriction" are the same fact and storing two encodings of one fact is how
 * a filter starts disagreeing with itself. Values are ISO — 1 = Monday … 7 =
 * Sunday — matching `branch_opening_hours.weekday` and `dayOfWeekIso`, so
 * nothing in this programme converts between weekday conventions.
 *
 * **Times are optional and paired.** A kitchen that has named its slots before
 * deciding their hours has a legitimate half-finished window; one that gives
 * a start and no end has made a mistake, and the message says which half is
 * missing rather than refusing the row on a constraint.
 */
final readonly class DeliveryWindowService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{
     *     code: string,
     *     name_en: string,
     *     name_ar?: string|null,
     *     starts_at?: string|null,
     *     ends_at?: string|null,
     *     weekdays?: list<int>|null,
     *     display_order?: int|null,
     *     is_active?: bool|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): DeliveryWindow
    {
        $organisationId = $this->requireOrganisation();
        $code = trim($attributes['code']);

        if (DeliveryWindow::withoutTenancy()->where('organisation_id', $organisationId)->where('code', $code)->exists()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This organisation already has a delivery window with that code.',
                ['conflicting_field' => 'code'],
            );
        }

        $times = $this->validatedTimes($attributes['starts_at'] ?? null, $attributes['ends_at'] ?? null);

        $window = new DeliveryWindow;
        $window->organisation_id = $organisationId;
        $window->code = $code;
        $window->name_en = trim($attributes['name_en']);
        $window->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? '';
        $window->starts_at = $times['starts_at'];
        $window->ends_at = $times['ends_at'];
        $window->weekdays = $this->validatedWeekdays($attributes['weekdays'] ?? null);
        $window->display_order = $attributes['display_order'] ?? 0;
        $window->is_active = $attributes['is_active'] ?? true;
        $window->created_by = $this->context->userId();
        $window->save();

        $this->audit->record(
            'catalogue.delivery_window_created',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_window',
            subjectId: (string) $window->getKey(),
            metadata: [
                'weekday_count' => count($window->weekdays),
                'is_active' => $window->is_active,
            ],
        );

        return $window;
    }

    /**
     * A partial update, evaluated against the **merged** row: sending only
     * `ends_at` compares it with the stored `starts_at`, because a client
     * moving one end of a window should not have to restate the other.
     *
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(DeliveryWindow $window, array $attributes): DeliveryWindow
    {
        if (array_key_exists('code', $attributes)) {
            throw $this->invalid('code', 'A delivery window code is fixed when the window is created. Rename the window instead.');
        }

        foreach (['name_en', 'name_ar'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];
            $trimmed = is_string($value) ? trim($value) : '';

            if ($field === 'name_en' && $trimmed === '') {
                throw $this->invalid('name_en', 'A delivery window must have a name.');
            }

            $window->setAttribute($field, $trimmed);
        }

        if (array_key_exists('starts_at', $attributes) || array_key_exists('ends_at', $attributes)) {
            $times = $this->validatedTimes(
                array_key_exists('starts_at', $attributes) ? $attributes['starts_at'] : $window->starts_at,
                array_key_exists('ends_at', $attributes) ? $attributes['ends_at'] : $window->ends_at,
            );

            $window->starts_at = $times['starts_at'];
            $window->ends_at = $times['ends_at'];
        }

        if (array_key_exists('weekdays', $attributes)) {
            $window->weekdays = $this->validatedWeekdays($attributes['weekdays']);
        }

        if (array_key_exists('display_order', $attributes) && is_int($attributes['display_order'])) {
            $window->display_order = $attributes['display_order'];
        }

        if (array_key_exists('is_active', $attributes) && is_bool($attributes['is_active'])) {
            $window->is_active = $attributes['is_active'];
        }

        $changed = array_keys($window->getDirty());

        if ($changed === []) {
            return $window;
        }

        $window->save();

        $this->audit->record(
            'catalogue.delivery_window_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'delivery_window',
            subjectId: (string) $window->getKey(),
            metadata: ['changed_fields' => $changed],
        );

        return $window;
    }

    /**
     * @return array{starts_at: string|null, ends_at: string|null}
     *
     * @throws ApiException
     */
    private function validatedTimes(mixed $startsAt, mixed $endsAt): array
    {
        $start = $this->validatedTime($startsAt, 'starts_at');
        $end = $this->validatedTime($endsAt, 'ends_at');

        if ($start === null && $end !== null) {
            throw $this->invalid('starts_at', 'A window that ends needs to start. Give both times, or neither.');
        }

        if ($start !== null && $end === null) {
            throw $this->invalid('ends_at', 'A window that starts needs to end. Give both times, or neither.');
        }

        // Both ends are present or both are absent by the time control reaches
        // here; the pair checks above are what guarantee it.
        if ($start !== null && $end <= $start) {
            throw $this->invalid(
                'ends_at',
                'A window has to end after it starts. Overnight slots are not supported yet — model one as two windows.',
            );
        }

        return ['starts_at' => $start, 'ends_at' => $end];
    }

    /**
     * @throws ApiException
     */
    private function validatedTime(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_string($value) || preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $value) !== 1) {
            throw $this->invalid($field, 'A time is written HH:MM on a 24-hour clock, in the branch\'s own timezone.');
        }

        return mb_strlen($value) === 5 ? $value.':00' : $value;
    }

    /**
     * @return list<int>
     *
     * @throws ApiException
     */
    private function validatedWeekdays(mixed $value): array
    {
        if ($value === null || $value === []) {
            return [];
        }

        if (! is_array($value)) {
            throw $this->invalid('weekdays', 'Weekdays are a list of whole numbers, 1 for Monday through 7 for Sunday. An empty list means every day.');
        }

        $days = [];

        foreach ($value as $day) {
            if (! is_int($day) || $day < 1 || $day > 7) {
                throw $this->invalid('weekdays', 'Weekdays are ISO numbers: 1 for Monday through 7 for Sunday.');
            }

            if (! in_array($day, $days, true)) {
                $days[] = $day;
            }
        }

        sort($days);

        // All seven is "every day", and every day is `[]`. One fact, one
        // encoding — otherwise a filter comparing two windows that run daily
        // would find them different.
        return count($days) === 7 ? [] : $days;
    }

    /**
     * @throws ApiException
     */
    private function requireOrganisation(): string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
    }

    private function trimmedOrNull(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
