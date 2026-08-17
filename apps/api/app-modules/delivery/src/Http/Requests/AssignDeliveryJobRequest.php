<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for handing a delivery job to a driver.
 *
 * **One field, and it is required.** There is no "unassign" through this
 * endpoint: a null `driver_user_id` would be a second, quieter operation
 * wearing the same URL — taking a run away from somebody is a decision worth
 * its own route and its own audit action when a kitchen needs one — and
 * `required` here is what keeps that decision from being made by an omitted
 * key.
 *
 * **Whether that user actually works here is not checked in this class**, and
 * the omission is the house split rather than an oversight. A form request
 * states the *shape* of a body; deciding that a uuid names an active member of
 * the organisation in context needs the tenant context, and no form request on
 * this platform reaches for it. The controller asks, and answers with the same
 * `validation.failed` envelope and the same field key a rule here would have
 * produced, so a client sees one shape for "that is not a driver we can send".
 */
class AssignDeliveryJobRequest extends FormRequest
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
            'driver_user_id' => ['required', 'uuid'],
        ];
    }

    public function driverUserId(): string
    {
        return (string) $this->validated('driver_user_id');
    }
}
