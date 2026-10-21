<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use App\Services\NoticeRecipients;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\B2b\Models\QuotationOrder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Mail\NoticeMessage;
use Illuminate\Support\Facades\Mail;
use Throwable;

use function Illuminate\Support\defer;

/**
 * The mail a quotation's life sends (owner, 2026-10-21): the kitchen hears of
 * a new request and of the buyer's decision, the buyer hears that a price is
 * ready. Nobody had to poll a list to find out any more.
 *
 * - **submitted** → the kitchen's members who may price quotations
 *   (`b2b_quotation.quote_organisation`);
 * - **quoted** → the buyer's reply contact, else whoever submitted it;
 * - **accepted / declined** → the same kitchen members.
 *
 * Every message is queued and sent after the transaction commits
 * ({@see NoticeMessage}), and a mail that cannot be queued is reported, never
 * thrown: a notice failing must not refuse the quotation it is about.
 */
final readonly class QuotationNotices
{
    private const string KITCHEN_PERMISSION = 'b2b_quotation.quote_organisation';

    public function __construct(private NoticeRecipients $recipients) {}

    public function submitted(Quotation $quotation): void
    {
        $lineCount = QuotationLine::withoutTenancy()->where('quotation_id', $quotation->getKey())->count();

        $this->toKitchen($quotation, 'quotation_submitted', fn (string $locale): array => [
            __('notices.quotation.submitted.heading', ['reference' => $quotation->reference, 'buyer' => $this->buyerName($quotation)], $locale),
            array_values(array_filter([
                trans_choice('notices.quotation.submitted.lines', $lineCount, ['count' => $lineCount], $locale),
                $quotation->requested_delivery_date === null ? null : __('notices.quotation.submitted.delivery', ['date' => $quotation->requested_delivery_date->toDateString()], $locale),
                $quotation->recurring ? __('notices.quotation.submitted.recurring', [], $locale) : null,
                $quotation->notes === null ? null : __('notices.quotation.submitted.note', ['note' => $quotation->notes], $locale),
            ])),
            __('notices.quotation.submitted.action', [], $locale),
            '/kitchen/quotations',
        ]);
    }

    public function quoted(Quotation $quotation): void
    {
        $email = $quotation->contact_email
            ?? User::query()->whereKey($quotation->submitted_by)->value('email');

        if (! is_string($email) || $email === '') {
            return;
        }

        $totalMinor = (int) QuotationLine::withoutTenancy()->where('quotation_id', $quotation->getKey())->sum('line_total_minor');
        $locale = 'en';

        $this->send($email, new NoticeMessage(
            'quotation_quoted',
            __('notices.quotation.quoted.heading', ['reference' => $quotation->reference], $locale),
            array_values(array_filter([
                __('notices.quotation.quoted.total', ['total' => $this->money($totalMinor, $quotation->currency_code)], $locale),
                $quotation->expires_at === null ? null : __('notices.quotation.quoted.expires', ['date' => $quotation->expires_at->toDateString()], $locale),
            ])),
            __('notices.quotation.quoted.action', [], $locale),
            $this->url('/corporate/quotations?state=quoted'),
            $locale,
        ));
    }

    public function accepted(Quotation $quotation): void
    {
        $runs = QuotationOrder::withoutTenancy()->where('quotation_id', $quotation->getKey())->orderBy('sequence')->get();
        $first = $runs->first();

        $this->toKitchen($quotation, 'quotation_accepted', fn (string $locale): array => [
            __('notices.quotation.accepted.heading', ['reference' => $quotation->reference, 'buyer' => $this->buyerName($quotation)], $locale),
            $first === null ? [] : [
                trans_choice('notices.quotation.accepted.orders', $runs->count(), ['count' => $runs->count(), 'date' => $first->delivery_date->toDateString()], $locale),
            ],
            __('notices.quotation.accepted.action', [], $locale),
            '/kitchen/order-desk/calendar',
        ]);
    }

    public function declined(Quotation $quotation): void
    {
        $this->toKitchen($quotation, 'quotation_declined', fn (string $locale): array => [
            __('notices.quotation.declined.heading', ['reference' => $quotation->reference, 'buyer' => $this->buyerName($quotation)], $locale),
            $quotation->decline_reason === null ? [] : [__('notices.quotation.declined.reason', ['reason' => $quotation->decline_reason], $locale)],
            __('notices.quotation.declined.action', [], $locale),
            '/kitchen/quotations',
        ]);
    }

    /**
     * @param  \Closure(string): array{0: string, 1: list<string>, 2: string, 3: string}  $compose  heading, lines, action label, path
     */
    private function toKitchen(Quotation $quotation, string $kind, \Closure $compose): void
    {
        $kitchenId = CorporateProgramme::withoutTenancy()->whereKey($quotation->corporate_programme_id)->value('kitchen_organisation_id');

        if (! is_string($kitchenId)) {
            return;
        }

        foreach ($this->recipients->holding($kitchenId, self::KITCHEN_PERMISSION) as $recipient) {
            [$heading, $lines, $action, $path] = $compose($recipient['locale']);
            $this->send($recipient['email'], new NoticeMessage($kind, $heading, $lines, $action, $this->url($path), $recipient['locale']));
        }
    }

    /**
     * Handed to the queue after the response, not during the request. On the
     * `sync` queue (tests, a laptop) a queued mail runs inline, and the queue's
     * job hooks clear the tenant context when it finishes — the request's next
     * scoped read then failed. Deferred, the request is over before that
     * happens; on Redis it makes no difference but one tick of latency.
     */
    private function send(string $email, NoticeMessage $message): void
    {
        defer(static function () use ($email, $message): void {
            try {
                Mail::to($email)->queue($message);
            } catch (Throwable $e) {
                report($e);
            }
        });
    }

    private function buyerName(Quotation $quotation): string
    {
        return (string) (Organisation::query()->whereKey($quotation->organisation_id)->value('name') ?? '');
    }

    private function money(int $minor, string $currency): string
    {
        return number_format($minor / 100, 2).' '.$currency;
    }

    private function url(string $path): string
    {
        return rtrim((string) config('app.frontend_url'), '/').$path;
    }
}
