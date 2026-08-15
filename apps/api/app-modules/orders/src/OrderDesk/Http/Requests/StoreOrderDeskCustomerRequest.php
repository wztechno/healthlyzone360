<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Requests;

use Closure;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Services\ContactValueNormaliser;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validation for writing down a cold caller.
 *
 * ## `phone` is required, and a cold caller *is* a telephone number
 *
 * Every other way an account comes into being carries an identity with it — a
 * registration has an email, a guest checkout has a verified contact, a
 * corporate provisioning has a signatory. This one has a voice on a telephone,
 * and the number is the only durable thing about the encounter: it is how the
 * kitchen rings back about tonight's delivery, it is what the next agent
 * searches on when the same person calls again, and an account without one is a
 * name nobody can act on. So it is required here rather than "recommended", and
 * a second, third and fourth number are added afterwards through the ordinary
 * contact endpoints.
 *
 * **Validated through `ContactValueNormaliser`, in the request.** The registry
 * would refuse an unnormalisable value anyway, as `422 validation.failed` with
 * `fields.value` — but `value` is not a field of this body, and an agent's
 * screen highlighting a field that does not exist is a form nobody can correct.
 * Running the same normaliser here names `phone`, refuses before the account row
 * is written, and — the part that matters — uses **exactly** the class that will
 * store the value, so a number this request accepts cannot be one the registry
 * then rejects.
 *
 * The normaliser refuses anything not already in E.164 and deliberately does not
 * guess a country code (see the class: guessing `+961` for a local-looking
 * string would send somebody else's handset a passcode). A desk agent takes the
 * country code the way they take the rest of the number — by asking.
 *
 * ## `display_name` is required, and is the only name there is
 *
 * `customer_accounts` has one name column, not a given/family pair, because the
 * platform's customer may be a company. A desk types what the caller says their
 * name is. `max:255` is the column, stated rather than assumed.
 *
 * ## The two reference codes are checked against the reference tables
 *
 * `preferred_language_code` and `country_code` are foreign keys on
 * `customer_accounts` (`languages.code`, `countries.code`). Left to the
 * database they would be a `23503` from inside a transaction — a 500 where a
 * 422 belongs — so they are checked here, by the `Rule::exists` the platform
 * checks a country code with elsewhere.
 */
class StoreOrderDeskCustomerRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request that
     * also guessed would give two answers to one question.
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
            'display_name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:255', $this->normalisablePhone()],
            'preferred_language_code' => ['nullable', 'string', 'size:2', Rule::exists('languages', 'code')],
            'country_code' => ['nullable', 'string', 'size:2', Rule::exists('countries', 'code')],
        ];
    }

    /**
     * @return array{
     *     display_name: string,
     *     phone: string,
     *     preferred_language_code: string|null,
     *     country_code: string|null
     * }
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        return [
            'display_name' => trim((string) $validated['display_name']),
            'phone' => trim((string) $validated['phone']),
            'preferred_language_code' => $this->stated($validated['preferred_language_code'] ?? null),
            'country_code' => $this->stated($validated['country_code'] ?? null),
        ];
    }

    /**
     * The number in the canonical form the registry will store, computed by the
     * class that will store it.
     *
     * Callable only after validation, which is where it is called from — the
     * rule above has already proved the value normalises, so the exception
     * branch is unreachable and returns the trimmed input rather than throwing a
     * second time.
     */
    public function normalisedPhone(): string
    {
        try {
            return $this->normaliser()->normalise(ContactChannel::Phone, (string) $this->validated('phone'));
        } catch (InvalidContactValue) {
            return trim((string) $this->validated('phone'));
        }
    }

    /**
     * A value the contact registry would accept, proved by asking it.
     */
    private function normalisablePhone(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_string($value)) {
                $fail('Enter the number in international format, starting with a plus and the country code.');

                return;
            }

            try {
                $this->normaliser()->normalise(ContactChannel::Phone, $value);
            } catch (InvalidContactValue $refusal) {
                $fail($refusal->getMessage());
            }
        };
    }

    private function normaliser(): ContactValueNormaliser
    {
        return app(ContactValueNormaliser::class);
    }

    /**
     * An empty string is not a shorter code, it is an absent one.
     */
    private function stated(mixed $value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));

        return $trimmed === '' ? null : $trimmed;
    }
}
