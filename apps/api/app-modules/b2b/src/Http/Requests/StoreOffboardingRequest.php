<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Enums\OffboardingTrigger;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for serving notice on a corporate relationship.
 *
 * **`organisation_id` is in the body rather than in the path**, and the reason
 * is what the path prefix already means. `/platform/b2b/…` is the platform's
 * review surface, reached with the *platform operator's* organisation selected
 * in `X-Organisation-Id`; a `{organisation}` segment would be a second
 * organisation in the same request with completely different meaning, which is
 * the confusion `/organisations/{organisation}/invitations` avoids by having
 * the two agree. Here they cannot agree — the whole point is that an operator
 * is acting on somebody else's company — so it goes in the body where it reads
 * as a subject rather than as a scope.
 *
 * No `exists:` rule on it. `OffboardingService::start()` refuses an
 * organisation that is not a `corporate_customer` and one with no agreement in
 * force, both with reasons a wind-up screen renders; a bare rule would turn the
 * first into "the selected value is invalid", which tells an operator nothing
 * about the company in front of them.
 *
 * **`trigger` is required and has no default.** `contract_end`,
 * `termination`, `non_renewal` and `client_request` are four different stories
 * about the same act, they are copied onto `reason`, and every one of them is
 * what somebody will read a year later when the company asks why. A default
 * would put one of those stories on the record without anybody choosing it.
 *
 * `effective_on` is optional and overrides the computed notice date. It exists
 * because a negotiated end date is a real thing — the parties agreed March 31st
 * — and the alternative would be an operator setting `notice_period_days` on
 * the agreement to make the arithmetic come out. `after_or_equal:today` is the
 * only shape rule: backdating notice is not a data-entry convenience, it is a
 * claim that somebody was told earlier than they were.
 */
class StoreOffboardingRequest extends FormRequest
{
    /**
     * Authorisation is the route's `platform.context` and
     * `permission:b2b_offboarding.manage_platform`; a form request that also
     * guessed would give two answers to one question.
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
            'organisation_id' => ['required', 'uuid'],
            'trigger' => ['required', Rule::enum(OffboardingTrigger::class)],
            'reason_note' => ['nullable', 'string', 'max:2000'],
            'effective_on' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
        ];
    }

    public function trigger(): OffboardingTrigger
    {
        /** @var string $value */
        $value = $this->validated('trigger');

        return OffboardingTrigger::from($value);
    }
}
