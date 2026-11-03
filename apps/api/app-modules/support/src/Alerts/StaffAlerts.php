<?php

declare(strict_types=1);

namespace Healthy360\Support\Alerts;

use App\Services\NoticeRecipients;
use Closure;
use Healthy360\Support\Identifiers\IdentifierService;
use Healthy360\Support\Mail\NoticeMessage;
use Healthy360\Support\Models\StaffNotification;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

use function Illuminate\Support\defer;

/**
 * The one service that tells a kitchen's managers and owners something needs
 * them: a bell row for each recipient, an email in their language, and an SMS
 * when the alert is an escalation ({@see StaffAlertType::isEscalation()}).
 *
 * **`data` never holds personal data.** No customer name, no allergy detail, no
 * address, no phone number: the order number, money and a severity flag, which is
 * all the keys `ALLOWED_DATA` lets through. The row outlives the customer, and
 * closing an account does not visit this table; the link to the order shows
 * everything else, to whoever may see it.
 *
 * **An alert about something other than an order** still carries `order_number`:
 * for those it is the reference its wording names, a date, a supplier or a dish,
 * or empty when the wording needs none. Rows already exist under that key.
 *
 * **Each recipient hears once.** `(user_id, type, subject_id)` is unique, and only
 * a recipient whose row was really written is mailed, so a job that repeats every
 * minute costs nothing and alerts nobody twice. A type that repeats
 * ({@see StaffAlertType::repeats()}) brings the row back unread and new instead,
 * and that counts as written.
 *
 * **The organisation's context is set here, not assumed.** A caller may be a
 * scheduled job with no tenant, and under row-level security that makes a read
 * return nothing and an insert fail.
 *
 * **An alert cannot refuse the order it is about.** This runs inside order
 * transactions, where any database error aborts the whole transaction. The work
 * therefore sits in a nested transaction, a `SAVEPOINT`, for the reason
 * `DeliveryJobProjector` gives, and a failure is reported and goes no further. The
 * context is set outside the savepoint: a rollback also undoes `set_config`, and
 * `during()` must be able to restore the caller's context in a live transaction.
 *
 * **Rows go with the order; mail waits for it.** The rows are part of the
 * caller's transaction and roll back with it. Delivery is registered after commit,
 * because `defer()` alone runs at the end of the request whatever the transaction
 * did. It is then deferred for the reason `QuotationNotices::send()` gives, and
 * `always` because the rows are committed: a request or job that fails later must
 * not swallow the only delivery those rows will ever get.
 */
final readonly class StaffAlerts
{
    private const string MANAGER_PERMISSION = 'order.supervise_organisation';

    /** What `data` may carry. See the class docblock. */
    private const array ALLOWED_DATA = ['order_number', 'total_minor', 'currency_code', 'severe'];

    public function __construct(
        private NoticeRecipients $recipients,
        private DatabaseTenantContext $tenantContext,
        private IdentifierService $identifiers,
    ) {}

    /**
     * @param  array{order_number: string, total_minor?: int, currency_code?: string, severe?: bool}  $data  order number, money and a severity flag only; any other key is dropped
     * @param  string|null  $requesterUserId  who to tell, for a type whose audience is `requester`
     * @param  string|null  $subjectType  what `$subjectId` names, when not the type's usual subject
     */
    public function send(StaffAlertType $type, string $organisationId, string $subjectId, array $data, ?string $requesterUserId = null, ?string $subjectType = null): void
    {
        $data = array_intersect_key($data, array_flip(self::ALLOWED_DATA));

        try {
            /** @var list<array{user_id: string, email: string, locale: string}> $alerted */
            $alerted = $this->tenantContext->during(null, $organisationId, null, fn (): array => DB::transaction(
                fn (): array => $this->writeRows($type, $organisationId, $subjectId, $subjectType ?? $type->subjectType(), $data, $requesterUserId),
            ));

            DB::afterCommit(function () use ($type, $alerted, $subjectId, $data): void {
                defer(fn () => $this->deliver($type, $alerted, $subjectId, $data), always: true);
            });
        } catch (Throwable $e) {
            report($e);
        }
    }

    /**
     * @param  array{order_number: string, total_minor?: int, currency_code?: string, severe?: bool}  $data
     * @return list<array{user_id: string, email: string, locale: string}> the recipients not already alerted
     */
    private function writeRows(StaffAlertType $type, string $organisationId, string $subjectId, string $subjectType, array $data, ?string $requesterUserId): array
    {
        $recipients = match ($type->audience()) {
            'owners' => $this->recipients->owners($organisationId),
            'requester' => $this->recipients->member($organisationId, (string) $requesterUserId),
            'managers' => $this->recipients->usersHolding($organisationId, self::MANAGER_PERMISSION),
        };

        // Escalations repeat every minute, so an hour between warnings is plenty.
        if ($recipients === [] && Cache::add("staff-alerts:no-recipients:{$organisationId}:{$type->value}", true, now()->addHour())) {
            Log::warning('Staff alert reached nobody: the organisation has no recipients.', [
                'organisation_id' => $organisationId,
                'type' => $type->value,
            ]);
        }

        $alerted = [];

        $encoded = json_encode($data, JSON_THROW_ON_ERROR);

        foreach ($recipients as $recipient) {
            $written = StaffNotification::withoutTenancy()->insertOrIgnore([
                'id' => $this->identifiers->generate(),
                'organisation_id' => $organisationId,
                'user_id' => $recipient['user_id'],
                'type' => $type->value,
                'subject_type' => $subjectType,
                'subject_id' => $subjectId,
                'data' => $encoded,
                'created_at' => now(),
            ]);

            if ($written === 0 && $type->repeats()) {
                $written = StaffNotification::withoutTenancy()
                    ->where('user_id', $recipient['user_id'])
                    ->where('type', $type->value)
                    ->where('subject_id', $subjectId)
                    ->update(['read_at' => null, 'created_at' => now(), 'data' => $encoded]);
            }

            if ($written === 1) {
                $alerted[] = $recipient;
            }
        }

        return $alerted;
    }

    /**
     * One recipient's failure, or their mail's, stops nobody else's and not their SMS.
     *
     * @param  list<array{user_id: string, email: string, locale: string}>  $recipients
     * @param  array{order_number: string, total_minor?: int, currency_code?: string, severe?: bool}  $data
     */
    private function deliver(StaffAlertType $type, array $recipients, string $subjectId, array $data): void
    {
        foreach ($recipients as $recipient) {
            $this->attempt(fn () => Mail::to($recipient['email'])->queue($this->message($type, $subjectId, $data, $recipient['locale'])));

            if ($type->isEscalation()) {
                $this->attempt(fn () => SendStaffAlertSms::dispatch(
                    $recipient['user_id'],
                    (string) __("notices.staff_alert.{$type->value}.sms", ['number' => $data['order_number']], $recipient['locale']),
                ));
            }
        }
    }

    /**
     * @param  array{order_number: string, total_minor?: int, currency_code?: string, severe?: bool}  $data
     */
    private function message(StaffAlertType $type, string $subjectId, array $data, string $locale): NoticeMessage
    {
        $lines = [(string) __("notices.staff_alert.{$type->value}.line", [], $locale)];

        if (isset($data['total_minor'], $data['currency_code'])) {
            $lines[] = (string) __($type->subjectType() === 'order' && $type->audience() !== 'requester' ? 'notices.staff_alert.total' : 'notices.staff_alert.amount', [
                'total' => number_format($data['total_minor'] / 100, 2).' '.$data['currency_code'],
            ], $locale);
        }

        $page = $type->page($subjectId);

        return new NoticeMessage(
            'staff_alert_'.$type->value,
            (string) __("notices.staff_alert.{$type->value}.heading", ['number' => $data['order_number']], $locale),
            $lines,
            // Named by where the link goes: an alert about an order may still open a page.
            (string) __(str_starts_with($page, '/kitchen/orders?') ? 'notices.staff_alert.action' : 'notices.staff_alert.action_page', [], $locale),
            rtrim((string) config('app.frontend_url'), '/').$page,
            $locale,
        );
    }

    /**
     * @param  Closure(): mixed  $delivery
     */
    private function attempt(Closure $delivery): void
    {
        try {
            $delivery();
        } catch (Throwable $e) {
            report($e);
        }
    }
}
