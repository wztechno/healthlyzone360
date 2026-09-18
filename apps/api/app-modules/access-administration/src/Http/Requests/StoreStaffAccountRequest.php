<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Requests;

use App\Concerns\PasswordValidationRules;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for opening an account on somebody's behalf.
 *
 * ## `email` or `local_part`, exactly one
 *
 * The split is the whole point of the feature. A colleague with a mailbox gets
 * a full address; a kitchen hand types `ahmad.khalil` and the organisation's
 * staff domain supplies the rest. Both produce an ordinary email address, so
 * nothing in the authentication pipeline learns that the second form exists.
 *
 * `required_without` in both directions makes one of them mandatory, and the
 * `prohibits` pair makes them mutually exclusive — a body carrying both would
 * be a client that had not decided, and silently preferring one would make the
 * other look like it worked.
 *
 * ## The password is validated exactly as a self-chosen one
 *
 * `passwordRules()`, the same trait `CreateNewUser` uses, so a provisioned
 * account cannot be weaker than a registered one. It is **not** `confirmed`
 * here, and that is the one deliberate difference: confirmation exists to
 * catch a typo by somebody who cannot see what they typed, and this password is
 * shown back to the administrator once before they hand it over. A second field
 * would be ceremony.
 *
 * ## `role_ids` may be empty
 *
 * Somebody can be given a login today and duties tomorrow, which is the
 * ordinary shape of a new starter's first morning. The same reasoning
 * `ReplaceMembershipRolesRequest` applies: a role set is a decision, and
 * forcing one would make an administrator invent it.
 */
class StoreStaffAccountRequest extends FormRequest
{
    use PasswordValidationRules;

    /**
     * Authorisation is the route's `permission:user.manage_organisation`,
     * stacked in the controller with a `Gate::allows()` on
     * `membership.invite_organisation` — minting a login and granting it a
     * seat are two decisions.
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
            'email' => ['required_without:local_part', 'prohibits:local_part', 'nullable', 'string', 'email', 'max:255'],
            'local_part' => ['required_without:email', 'prohibits:email', 'nullable', 'string', 'max:64', 'regex:/^[a-z0-9]+([._-][a-z0-9]+)*$/'],

            'given_name' => ['required', 'string', 'max:255'],
            'family_name' => ['required', 'string', 'max:255'],

            'password' => array_values(array_filter(
                $this->passwordRules(),
                static fn (mixed $rule): bool => $rule !== 'confirmed',
            )),

            'preferred_language_code' => ['nullable', 'string', 'size:2', Rule::exists('languages', 'code')->where('is_active', true)],

            'role_ids' => ['present', 'array'],
            'role_ids.*' => ['uuid'],

            'branch_id' => ['nullable', 'uuid'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'local_part.regex' => 'A sign-in name is lowercase letters and numbers, optionally separated by a dot, dash or underscore.',
            'email.prohibits' => 'Give a full email address or a sign-in name, not both.',
            'local_part.prohibits' => 'Give a full email address or a sign-in name, not both.',
        ];
    }

    /**
     * @return array{
     *     email: string|null,
     *     local_part: string|null,
     *     given_name: string,
     *     family_name: string,
     *     password: string,
     *     preferred_language_code: string|null,
     *     role_ids: list<string>,
     *     branch_id: string|null
     * }
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $data */
        $data = $this->validated();

        return [
            'email' => $this->optional($data['email'] ?? null),
            'local_part' => $this->optional($data['local_part'] ?? null),
            'given_name' => (string) $data['given_name'],
            'family_name' => (string) $data['family_name'],
            'password' => (string) $data['password'],
            'preferred_language_code' => $this->optional($data['preferred_language_code'] ?? null),
            /** @var list<string> */
            'role_ids' => array_values(array_map('strval', (array) ($data['role_ids'] ?? []))),
            'branch_id' => $this->optional($data['branch_id'] ?? null),
        ];
    }

    private function optional(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
