<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for declining a B2B application.
 *
 * `applicant_message` is **required**, and that is the one rule in this file
 * worth arguing about. An unexplained refusal is not a decision the company
 * can act on: they cannot tell whether to correct a document, apply again next
 * year, or stop trying. Requiring a sentence costs a reviewer thirty seconds
 * and is the difference between a decision and a wall. The service refuses a
 * blank one too, so a client that sends whitespace gets the same answer.
 *
 * `internal_note` stays internal. It is the reviewer's own record and is never
 * served to the applicant — the shape of a decline is deliberately two fields
 * so that "we were not comfortable with the credit history" and "we are unable
 * to approve your application at this time" can both be true and only one of
 * them travels.
 */
class DeclineApplicationRequest extends FormRequest
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
            'applicant_message' => ['required', 'string', 'max:2000'],
            'internal_note' => ['nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * @return array{applicant_message: string, internal_note: string|null}
     */
    public function payload(): array
    {
        /** @var string $applicant */
        $applicant = $this->validated('applicant_message');
        $internal = $this->validated('internal_note');

        return [
            'applicant_message' => $applicant,
            'internal_note' => is_string($internal) && trim($internal) !== '' ? $internal : null,
        ];
    }
}
