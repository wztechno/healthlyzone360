<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Models\SubscriptionEvent;
use Healthy360\Tenancy\TenantContext;

/**
 * Every subscription event, written to both places it belongs.
 *
 * **One call, two records, and they are not duplicates.** The
 * `subscription_events` row is the customer's own history — safe to render,
 * outliving audit retention, and allowed to carry the allergen classes that
 * explain a skip. The `audit_logs` row is the platform's forensic trail, with
 * the correlation identifier, the tenant stamp and the redactor. A single
 * writer for both is what stops the two from drifting into disagreement about
 * what happened.
 *
 * **The audit metadata never carries a key containing `code`.** The redactor
 * blanks any such key as a substring match, so `allergen_classes` and
 * `cancellation_reason` are spelled the way they are on purpose — the same
 * convention `OrderLifecycle` states for its own cancellation reason, and the
 * reason `subscription_meal_choices.unsafe_allergen_classes` is not called
 * `..._codes`. The customer-facing row is under no such constraint and carries
 * the detail in full.
 */
final readonly class SubscriptionJournal
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @param  array<string, mixed>  $detail  the customer-readable half; may carry allergen classes
     * @param  array<string, scalar|list<scalar>|null>  $auditMetadata  extra keys for the forensic half, never ending in `_code`
     */
    public function record(
        Subscription $subscription,
        string $eventType,
        ?CarbonImmutable $deliveryDate = null,
        array $detail = [],
        ?string $subscriptionDeliveryId = null,
        ?string $actorUserId = null,
        array $auditMetadata = [],
    ): SubscriptionEvent {
        $now = CarbonImmutable::now();

        $event = new SubscriptionEvent;
        $event->subscription_id = (string) $subscription->getKey();
        $event->organisation_id = $subscription->organisation_id;
        $event->subscription_delivery_id = $subscriptionDeliveryId;
        $event->event_type = $eventType;
        $event->delivery_date = $deliveryDate;
        $event->detail = $detail;
        $event->actor_user_id = $actorUserId ?? $this->context->userId();
        $event->occurred_at = $now;
        $event->save();

        $this->audit->record(
            'subscription.'.$eventType,
            actorUserId: $actorUserId ?? $this->context->userId(),
            subjectType: 'subscription',
            subjectId: (string) $subscription->getKey(),
            metadata: [
                'customer_account_id' => $subscription->customer_account_id,
                'delivery_date' => $deliveryDate?->toDateString(),
                'balance_days_total' => $subscription->balance_days_total,
                'balance_days_consumed' => $subscription->balance_days_consumed,
                ...$auditMetadata,
            ],
        );

        return $event;
    }
}
