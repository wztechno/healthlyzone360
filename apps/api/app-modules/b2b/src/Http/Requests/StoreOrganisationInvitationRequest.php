<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for offering somebody a place in an organisation.
 *
 * `role_code` is a plain string with **no `exists` rule**, following the K1.2
 * convention and for a sharper reason than usual: roles are per-organisation
 * *and* platform templates, so `exists:roles,code` would happily accept
 * another tenant's bespoke role name. The code is resolved where the tenant
 * scope is real.
 *
 * `branch_id` is likewise unchecked here. The service refuses a branch
 * belonging to a different organisation by name, and the controller resolves
 * it inside the tenant scope — a bare existence rule would be a cross-tenant
 * read dressed up as validation.
 *
 * `message` is the sentence that travels with the invitation. It is bounded
 * rather than absent because an invitation with no context is an email people
 * assume is phishing, and rightly.
 *
 * There is nothing here about the token, and there is nothing about it in the
 * response either. The plaintext exists once, in the mail; only its SHA-256
 * reaches the database.
 */
class StoreOrganisationInvitationRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
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
            'email' => ['required', 'email', 'max:255'],
            'role_code' => ['required', 'string', 'max:60'],
            'branch_id' => ['nullable', 'uuid'],
            'message' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * @return array{email: string, role_code: string, branch_id: string|null, message: string|null}
     */
    public function payload(): array
    {
        /** @var string $email */
        $email = $this->validated('email');
        /** @var string $roleCode */
        $roleCode = $this->validated('role_code');
        $branch = $this->validated('branch_id');
        $message = $this->validated('message');

        return [
            'email' => $email,
            'role_code' => $roleCode,
            'branch_id' => is_string($branch) && $branch !== '' ? $branch : null,
            'message' => is_string($message) && trim($message) !== '' ? trim($message) : null,
        ];
    }
}
