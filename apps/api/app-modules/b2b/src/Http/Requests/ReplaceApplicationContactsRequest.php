<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Enums\ApplicationContactRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a full replacement of the people an applicant company names.
 *
 * `present` rather than `required`, and the difference is the whole point of a
 * set-replace: `{"contacts": []}` means "there is nobody left to name", and
 * `required` would reject the one payload that expresses a deletion. A client
 * that removed a row has to be able to say so.
 *
 * **One contact per role, and the role is the key.** There is no `id` field
 * and no ordering: the four slots are the shape, the service refuses a
 * duplicate role by name, and rows are replaced wholesale so an identifier a
 * client held would be stale the moment it was used.
 *
 * The "an email or a phone, at least one" rule is not expressed here, and
 * deliberately: it is a condition across two fields whose failure has to name
 * the row it happened in, and the service already produces
 * `contacts.2.email` with a sentence that says why. A `required_without` pair
 * would produce two messages for one problem and neither would explain it.
 */
class ReplaceApplicationContactsRequest extends FormRequest
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
            'contacts' => ['present', 'array', 'max:4'],
            'contacts.*.role' => ['required', new Enum(ApplicationContactRole::class)],
            'contacts.*.name' => ['required', 'string', 'max:160'],
            'contacts.*.title' => ['nullable', 'string', 'max:120'],
            'contacts.*.email' => ['nullable', 'email', 'max:255'],
            'contacts.*.phone' => ['nullable', 'string', 'max:32'],
            'contacts.*.notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * @return list<array{
     *     role: string,
     *     name: string,
     *     title?: string|null,
     *     email?: string|null,
     *     phone?: string|null,
     *     notes?: string|null
     * }>
     */
    public function contacts(): array
    {
        /** @var list<array{role: string, name: string, title?: string|null, email?: string|null, phone?: string|null, notes?: string|null}> $contacts */
        $contacts = $this->validated('contacts') ?? [];

        return $contacts;
    }
}
