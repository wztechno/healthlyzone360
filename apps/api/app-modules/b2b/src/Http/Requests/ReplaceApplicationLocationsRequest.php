<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of where an applicant company wants food.
 *
 * `present` rather than `required`: an empty array is a company saying it has
 * no delivery points yet, which is a legitimate state before submission and
 * one `required` would refuse to let anybody express.
 *
 * `delivery_area_id` has **no `exists` rule**, following the K1.2 convention:
 * the gazetteer is platform data and a bare existence check would happily
 * accept an identifier from a country the applicant has nothing to do with.
 * The anchor is resolved where the tenant scope is real.
 *
 * "Only one primary" and "only one billing address" are not expressed here.
 * They are conditions *across* the collection, and the service answers them
 * with a message about the set — `locations`, "only one location can be the
 * main delivery address" — where a per-row rule would blame an arbitrary row
 * for a problem the row does not have.
 */
class ReplaceApplicationLocationsRequest extends FormRequest
{
    /**
     * Authorisation is ownership, and ownership is the service's
     * `applicant_user_id` check; a form request that also guessed would give
     * two answers to one question.
     */
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
            'locations' => ['present', 'array', 'max:50'],
            'locations.*.label' => ['required', 'string', 'max:120'],
            'locations.*.delivery_area_id' => ['nullable', 'uuid'],
            'locations.*.address_line1' => ['required', 'string', 'max:255'],
            'locations.*.address_line2' => ['nullable', 'string', 'max:255'],
            'locations.*.city' => ['nullable', 'string', 'max:120'],
            'locations.*.country_code' => ['nullable', 'string', 'size:2'],
            'locations.*.contact_name' => ['nullable', 'string', 'max:160'],
            'locations.*.contact_phone' => ['nullable', 'string', 'max:32'],
            'locations.*.delivery_notes' => ['nullable', 'string', 'max:1000'],
            'locations.*.is_primary' => ['nullable', 'boolean'],
            'locations.*.is_billing_address' => ['nullable', 'boolean'],
            'locations.*.expected_headcount' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ];
    }

    /**
     * @return list<array{
     *     label: string,
     *     delivery_area_id?: string|null,
     *     address_line1: string,
     *     address_line2?: string|null,
     *     city?: string|null,
     *     country_code?: string|null,
     *     contact_name?: string|null,
     *     contact_phone?: string|null,
     *     delivery_notes?: string|null,
     *     is_primary?: bool|null,
     *     is_billing_address?: bool|null,
     *     expected_headcount?: int|null
     * }>
     */
    public function locations(): array
    {
        /** @var list<array{label: string, delivery_area_id?: string|null, address_line1: string, address_line2?: string|null, city?: string|null, country_code?: string|null, contact_name?: string|null, contact_phone?: string|null, delivery_notes?: string|null, is_primary?: bool|null, is_billing_address?: bool|null, expected_headcount?: int|null}> $locations */
        $locations = $this->validated('locations') ?? [];

        return $locations;
    }
}
