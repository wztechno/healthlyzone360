<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for bringing a kitchen into existence.
 *
 * ## The reference codes carry `exists` rules and the slug does not
 *
 * `country_code`, `default_currency_code` and `default_language_code` all
 * point at reference tables that are the same for everybody, so an existence
 * rule here is a cheap, honest check and produces a field-level message
 * instead of a foreign-key violation. `slug` is checked in the service
 * instead: the uniqueness question and the insert have to be the same
 * decision, and a validator that answered it separately would leave a race
 * between the check and the write.
 *
 * ## Both names are required
 *
 * `organisations` stores a single `name`, so the Arabic goes onto the sales
 * channel the kitchen sells through — which does carry both. Collecting it now
 * rather than later is the point: the operator typing the English name knows
 * the Arabic one, and a screen that asks for it three weeks later gets a
 * transliteration.
 *
 * ## `timezone` is a plain string with a bounded length
 *
 * Not `Rule::in(timezone_identifiers_list())`. The list is the PHP runtime's,
 * it changes with the tzdata the container happens to ship, and a validator
 * that refused `Asia/Dubai` after a base-image bump would be a validator
 * nobody could debug. Branches already carry free-text timezones for exactly
 * this reason.
 */
class StoreKitchenOrganisationRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` and `platform.context`
     * middleware; a form request that also guessed would give two answers to
     * one question.
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
            'name_en' => ['required', 'string', 'max:160'],
            'name_ar' => ['required', 'string', 'max:160'],
            'slug' => ['required', 'string', 'max:100', 'regex:/^[a-z0-9]+(-[a-z0-9]+)*$/'],
            'country_code' => ['required', 'string', 'size:2', Rule::exists('countries', 'code')],
            'default_currency_code' => ['required', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'default_language_code' => ['required', 'string', 'size:2', Rule::exists('languages', 'code')],
            'timezone' => ['required', 'string', 'max:64'],
            'branch_name' => ['required', 'string', 'max:160'],
            'city' => ['nullable', 'string', 'max:120'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'slug.regex' => 'A slug is lowercase words joined by single hyphens, for example "verdant-kitchen".',
        ];
    }

    /**
     * @return array{
     *     name_en: string,
     *     name_ar: string,
     *     slug: string,
     *     country_code: string,
     *     default_currency_code: string,
     *     default_language_code: string,
     *     timezone: string,
     *     branch_name: string,
     *     city: string|null
     * }
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $data */
        $data = $this->validated();

        $city = $data['city'] ?? null;

        return [
            'name_en' => (string) $data['name_en'],
            'name_ar' => (string) $data['name_ar'],
            'slug' => (string) $data['slug'],
            'country_code' => (string) $data['country_code'],
            'default_currency_code' => (string) $data['default_currency_code'],
            'default_language_code' => (string) $data['default_language_code'],
            'timezone' => (string) $data['timezone'],
            'branch_name' => (string) $data['branch_name'],
            'city' => is_string($city) && trim($city) !== '' ? trim($city) : null,
        ];
    }
}
