<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for offering somebody ownership of a kitchen.
 *
 * There is no `role_code` field, and its absence is the whole shape of this
 * endpoint. `POST /organisations/{organisation}/invitations` already exists
 * for a member of an organisation to invite anybody to any role inside it.
 * This is a different act: the platform naming the person who will run a
 * tenant. Letting the caller choose the role would make it the general
 * endpoint again, with `platform.context` in front of it for no reason.
 *
 * `name` is optional and never stored. It goes into the greeting line of the
 * email and nowhere else — the person's real name arrives with their profile
 * when they accept, and a name typed by an operator into an invitation form
 * would be a second, worse copy of it.
 */
class InviteKitchenOwnerRequest extends FormRequest
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
            'email' => ['required', 'email', 'max:160'],
            'name' => ['nullable', 'string', 'max:160'],
            'message' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * @return array{email: string, name: string|null, message: string|null}
     */
    public function payload(): array
    {
        /** @var string $email */
        $email = $this->validated('email');
        $name = $this->validated('name');
        $message = $this->validated('message');

        return [
            'email' => $email,
            'name' => is_string($name) && trim($name) !== '' ? trim($name) : null,
            'message' => is_string($message) && trim($message) !== '' ? trim($message) : null,
        ];
    }
}
