<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Concerns;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * Query-string reading for the anonymous marketplace endpoints.
 *
 * ## Unsupported filters are reported, not ignored
 *
 * The consumer contract asks for filters the platform stores nothing for:
 * cuisine, meal type, preparation time, and every nutrition band. Silently
 * ignoring one is the worst available behaviour — a person who filters to
 * "under 500 kcal" and is shown everything has been told a falsehood by
 * omission. Refusing the whole request with a `400` is barely better: the rest
 * of the filter is perfectly answerable, and a client cannot know in advance
 * which of its controls the deployment supports.
 *
 * So the parameter is accepted, has no effect, and its name comes back in
 * `meta.unsupported_filters`. A client can render "we cannot filter by energy
 * yet" from a list it did not have to hard-code, and the day N1 stores
 * nutrition the list shortens without a contract change.
 */
trait ReadsMarketplaceFilters
{
    /**
     * Parameters the marketplace accepts, cannot honour, and names in the
     * response. Each is a filter over data no table holds.
     *
     * @return list<string>
     */
    protected function unsupportableParameters(): array
    {
        return [
            'cuisines',
            'meal_types',
            'preparation_minutes_max',
            'energy_min',
            'energy_max',
            'protein_min',
            'carbohydrate_max',
            'fat_max',
            'sort',
            'direction',
        ];
    }

    /**
     * The unsupportable parameters this request actually sent.
     *
     * @return list<string>
     */
    protected function unsupportedFilters(Request $request): array
    {
        return array_values(array_filter(
            $this->unsupportableParameters(),
            static fn (string $parameter): bool => $request->query($parameter) !== null
                && $request->query($parameter) !== '',
        ));
    }

    /**
     * A comma-separated list parameter, or null when absent.
     *
     * @return list<string>|null
     *
     * @throws ApiException
     */
    protected function listParameter(Request $request, string $name, int $maximum = 50): ?array
    {
        $raw = $request->query($name);

        if ($raw === null || $raw === '') {
            return null;
        }

        if (! is_string($raw)) {
            throw $this->invalid($name, 'This filter is a comma-separated list.');
        }

        $values = array_values(array_unique(array_filter(
            array_map(trim(...), explode(',', $raw)),
            static fn (string $value): bool => $value !== '',
        )));

        if ($values === []) {
            return null;
        }

        if (count($values) > $maximum) {
            throw $this->invalid($name, "This filter accepts at most {$maximum} values.");
        }

        return $values;
    }

    /**
     * @throws ApiException
     */
    protected function stringParameter(Request $request, string $name, int $maxLength = 120): ?string
    {
        $raw = $request->query($name);

        if ($raw === null || $raw === '') {
            return null;
        }

        if (! is_string($raw) || mb_strlen($raw) > $maxLength) {
            throw $this->invalid($name, "This filter is a string of at most {$maxLength} characters.");
        }

        return trim($raw);
    }

    /**
     * @throws ApiException
     */
    protected function integerParameter(Request $request, string $name, int $minimum = 0): ?int
    {
        $raw = $request->query($name);

        if ($raw === null || $raw === '') {
            return null;
        }

        if (! is_string($raw) || preg_match('/^\d+$/', $raw) !== 1) {
            throw $this->invalid($name, 'This filter is a whole number.');
        }

        $value = (int) $raw;

        if ($value < $minimum) {
            throw $this->invalid($name, "This filter is a whole number of at least {$minimum}.");
        }

        return $value;
    }

    /**
     * A `YYYY-MM-DD` date. Validated on shape rather than parsed loosely:
     * `strtotime` accepts "tomorrow", which is not a date a client sent on
     * purpose.
     *
     * @throws ApiException
     */
    protected function dateParameter(Request $request, string $name): ?string
    {
        $raw = $request->query($name);

        if ($raw === null || $raw === '') {
            return null;
        }

        if (! is_string($raw) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) !== 1) {
            throw $this->invalid($name, 'This filter is a calendar date, YYYY-MM-DD.');
        }

        return $raw;
    }

    protected function invalid(string $parameter, string $message): ApiException
    {
        return new ApiException(ErrorCode::RequestInvalid, $message, ['parameter' => $parameter]);
    }
}
