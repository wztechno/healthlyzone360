<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Requests;

use Healthy360\AccessControl\Services\PermissionRegistry;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for renaming a role and replacing what it grants.
 *
 * ## `code` is absent, and that is the difference from the store request
 *
 * A role's code is what `MembershipGranter::role()` matches an invitation on,
 * so changing it would silently redirect every outstanding invitation naming
 * the old one — and would, on a role that shadows a platform template, change
 * which of the two an acceptance resolves to. Neither is a consequence anybody
 * editing a permission list expects from a form that also has a Name field.
 * Renaming, as a person means it, is `name_en`/`name_ar`.
 *
 * Everything else is the store request's rules for the store request's reasons:
 * `permissions` is shape-checked here and decided by `GrantBoundary`, an empty
 * grant set is legitimate, and `is_system` is not a field.
 */
class UpdateOrganisationRoleRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission:role.manage_organisation`
     * middleware plus the controller's `Gate::authorize('update', $role)`,
     * which is where a platform template is refused. A form request that also
     * guessed would give two answers to one question.
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
            'permissions.*.regex' => 'A permission code looks like "order.view_organisation".',
        ];
    }

    /**
     * @return array{name_en: string, name_ar: string, description_en: string|null, description_ar: string|null, permissions: list<string>}
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $data */
        $data = $this->validated();

        return [
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
