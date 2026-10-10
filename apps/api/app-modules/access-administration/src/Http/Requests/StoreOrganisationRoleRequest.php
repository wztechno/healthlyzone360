<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Requests;

use Healthy360\AccessControl\Services\PermissionRegistry;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for defining a role of this kitchen's own.
 *
 * ## `code` is shaped here and its availability is decided in the service
 *
 * The regex is the registry's own convention for an identifier — lowercase
 * words joined by single underscores — so that a kitchen's `evening_counter`
 * sits beside the platform's `order_desk_agent` and reads as the same kind of
 * thing. Whether it is *taken* is `RoleWriter`'s question, because the check
 * and the insert have to be one decision: a validator answering it separately
 * leaves a race between the two, and the unique index would win that race with
 * a foreign-key violation instead of a field message.
 *
 * `is_system` is not in the rules at all, which is stronger than refusing it.
 * A tenant-created role is by definition not platform-defined, and a field that
 * could set the flag could create a role its own author could then never edit.
 *
 * ## `permissions` is validated for *shape* only
 *
 * The rule below says "strings that look like permission codes". Whether each
 * one is registered, assignable, and permitted to an organisation role is
 * `GrantBoundary`'s question, and it deliberately stays there rather than being
 * half-answered by an `exists` rule: the boundary has to hold for every write
 * path, including ones that never pass through this request, and a rule that
 * duplicated part of it here would eventually disagree with it.
 *
 * An empty array is allowed. A role that grants nothing is a legitimate thing
 * to define — a kitchen sketching out a shift before deciding what it may do —
 * and refusing it would be a rule invented for tidiness.
 */
class StoreOrganisationRoleRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission:role.manage_organisation`
     * middleware plus the controller's `Gate::authorize()` against
     * `RolePolicy`. A form request that also guessed would give two answers to
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
            'code' => ['required', 'string', 'max:64', 'regex:/^[a-z][a-z0-9_]*$/'],
            'name_en' => ['required', 'string', 'max:120'],
            'name_ar' => ['required', 'string', 'max:120'],
            'description_en' => ['nullable', 'string', 'max:500'],
            'description_ar' => ['nullable', 'string', 'max:500'],
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', 'regex:'.PermissionRegistry::CODE_FORMAT],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'code.regex' => 'A role code is lowercase words joined by single underscores, for example "evening_counter".',
            'permissions.*.regex' => 'A permission code looks like "order.view_organisation".',
        ];
    }

    /**
     * @return array{code: string, name_en: string, name_ar: string, description_en: string|null, description_ar: string|null, permissions: list<string>}
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $data */
        $data = $this->validated();

        return [
            'code' => (string) $data['code'],
            'name_en' => (string) $data['name_en'],
            'name_ar' => (string) $data['name_ar'],
            'description_en' => $this->optionalText($data['description_en'] ?? null),
            'description_ar' => $this->optionalText($data['description_ar'] ?? null),
            /** @var list<string> */
            'permissions' => array_values(array_map('strval', (array) $data['permissions'])),
        ];
    }

    /** Blank and absent are the same thing for prose: both mean "no description". */
    private function optionalText(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
