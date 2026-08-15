<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Enums\ApplicationSection;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for handing an application back with a question.
 *
 * `information_request` is required and is prose on purpose. What a reviewer
 * needs is rarely a field — "the registration certificate is illegible", "the
 * trading name on the licence is not the one you gave us" — and a closed
 * vocabulary would force every real question through an `other` that says
 * nothing. The applicant reads this verbatim.
 *
 * `sections` is optional, and **an empty list is meaningful rather than
 * sloppy**: it means the reviewer wants documents rather than answers, so
 * nothing on the form reopens. Naming sections is what narrows the applicant's
 * writable set, and narrowing to nothing is a legitimate request.
 */
class RequestApplicationInformationRequest extends FormRequest
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
            'information_request' => ['required', 'string', 'max:2000'],
            'sections' => ['nullable', 'array', 'max:4'],
            'sections.*' => ['required', new Enum(ApplicationSection::class)],
        ];
    }

    public function information(): string
    {
        /** @var string $request */
        $request = $this->validated('information_request');

        return $request;
    }

    /**
     * @return list<ApplicationSection>
     */
    public function sections(): array
    {
        /** @var list<string> $named */
        $named = $this->validated('sections') ?? [];

        return array_values(array_filter(array_map(ApplicationSection::tryFrom(...), $named)));
    }
}
