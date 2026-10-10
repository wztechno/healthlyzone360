<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for where somebody works.
 *
 * One field, and it is `present` rather than `required`: null is the value that
 * means organisation-wide, so a rule demanding a branch would make the
 * organisation-wide case unreachable. `present` is what distinguishes "make
 * this person organisation-wide" from "I forgot to send the field", which on a
 * `PATCH` are otherwise the same request.
 *
 * Existence is checked in the controller, inside the tenant scope, for the
 * reason `OrganisationInvitationStoreController::branch()` gives: read through
 * the ordinary query so the global organisation scope is what refuses another
 * tenant's branch, and a cross-tenant identifier never becomes a readable row
 * in the first place.
 */
class UpdateMembershipScopeRequest extends FormRequest
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
            'branch_id' => ['present', 'nullable', 'uuid'],
        ];
    }

    public function branchId(): ?string
    {
        /** @var array<string, mixed> $data */
        $data = $this->validated();

        $branchId = $data['branch_id'] ?? null;

        return is_string($branchId) && $branchId !== '' ? $branchId : null;
    }
}
