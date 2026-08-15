<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for setting aside an outstanding settlement position.
 *
 * **One field, and it is required prose.** `OffboardingService::waiveSettlement()`
 * refuses an empty reason with `offboarding.waiver_needs_reason` — "a waiver
 * nobody explained is not a waiver" — and the rule here is what turns that into
 * a field error a form can attach to the textarea rather than a 422 with no
 * field name.
 *
 * `min:10` is the one judgement in this file. A waiver is the escape hatch
 * around the only settlement check that can actually refuse, it is written into
 * its own audit action so it can never be mistaken for a clearance, and "ok" is
 * not a reason anybody can review a year later. Ten characters does not make
 * somebody thoughtful; it makes the empty gesture take as long as typing a real
 * one.
 *
 * There is no `authorised_by` field. Who is waiving is the authenticated
 * caller, and a body that could name somebody else would be an audit row
 * attributing a decision to a person who did not make it.
 */
class WaiveSettlementRequest extends FormRequest
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
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ];
    }
}
