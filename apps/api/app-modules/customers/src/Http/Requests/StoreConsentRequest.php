<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for recording acceptance of one or more consent texts.
 *
 * A list rather than a single code, because that is how the screen works: an
 * onboarding step presents several texts with several checkboxes and the person
 * ticks them in one act. Splitting that into several requests would let a
 * network failure record half a decision, and half a consent decision is the
 * one thing a regulator will ask about.
 *
 * The version is never client-supplied. A grant is recorded against the current
 * version of the definition, read by the ledger at the moment of writing; a
 * body that named a version would let a client accept a text that has since
 * been reissued, which is a way of consenting to words nobody is showing any
 * more.
 *
 * No `exists` rule on the codes. An unknown code is skipped by the ledger
 * rather than refused — a client that sends one has a stale catalogue, not a
 * malformed request — and the response is the caller's full position, so what
 * was and was not recorded is visible without a rule that would have to name
 * the table.
 */
class StoreConsentRequest extends FormRequest
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
            'codes' => ['required', 'array', 'min:1', 'max:40'],
            'codes.*' => ['required', 'string', 'max:80'],
        ];
    }

    /**
     * @return array{codes: list<string>}
     */
    public function payload(): array
    {
        /** @var array{codes: list<string>} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
