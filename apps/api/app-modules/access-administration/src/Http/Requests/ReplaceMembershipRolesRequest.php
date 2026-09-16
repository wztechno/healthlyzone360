<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for "this person holds exactly these roles".
 *
 * ## An empty array is valid, and it means something
 *
 * `roles: []` strips somebody of every role while leaving them a member. That
 * is a real state — a new starter whose duties have not been decided, somebody
 * moved off a shift — and it is not the same as ending their membership, which
 * is a different endpoint with a different consequence. Requiring at least one
 * role would force an administrator to invent one.
 *
 * ## The bounds are validated for order, and nothing else
 *
 * `expires_at` after `starts_at` is the one relationship worth checking here,
 * because a window that closes before it opens is a typo rather than a
 * decision. Whether either is in the past is deliberately not checked:
 * backdating an assignment is how a kitchen records what was already true, and
 * a validator that refused it would make the console unable to describe
 * reality.
 *
 * Whether each role *exists in this organisation* is `MembershipRoleAssigner`'s
 * question, resolved through the tenant scope so a cross-tenant identifier
 * never becomes a readable row. An `exists` rule here would answer it without
 * the scope and would leak that another kitchen has a role at that identifier.
 */
class ReplaceMembershipRolesRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission:role.manage_organisation`
     * middleware — assigning a role is naming what somebody may do, which is
     * that code's own description ("roles **and role assignments**").
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
            'roles' => ['present', 'array'],
            'roles.*.role_id' => ['required', 'uuid'],
            'roles.*.starts_at' => ['nullable', 'date'],
            'roles.*.expires_at' => ['nullable', 'date', 'after:roles.*.starts_at'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'roles.*.expires_at.after' => 'A role cannot stop applying before it starts.',
        ];
    }

    /**
     * @return list<array{role_id: string, starts_at: string|null, expires_at: string|null}>
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $data */
        $data = $this->validated();

        /** @var list<array<string, mixed>> $rows */
        $rows = (array) $data['roles'];

        return array_values(array_map(static fn (array $row): array => [
            'role_id' => (string) $row['role_id'],
            'starts_at' => isset($row['starts_at']) && $row['starts_at'] !== null ? (string) $row['starts_at'] : null,
            'expires_at' => isset($row['expires_at']) && $row['expires_at'] !== null ? (string) $row['expires_at'] : null,
        ], $rows));
    }
}
