<?php

declare(strict_types=1);

namespace Healthy360\Orders\Jobs;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\CustomerOrderEvent;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Support\Alerts\TwilioSms;
use Healthy360\Support\Mail\NoticeMessage;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * One customer notice: an email, and a text when Twilio is configured.
 *
 * Ids only on the queue. The address, the number and the language are read here,
 * and the mail goes with `sendNow()` because `NoticeMessage` queues itself, which
 * would put the customer's address on Horizon's failed-job screen.
 *
 * The kitchen's context is set first: the row policy shows a consumer's account
 * only to a kitchen holding an order against it, and a worker has no context of
 * its own. An account that was anonymised meanwhile has no live contact point, so
 * it is told nothing.
 *
 * One channel failing leaves the other standing, and neither is retried: a second
 * attempt could tell a customer twice, and this is news, not a record.
 */
final class SendCustomerOrderNotice implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public string $orderId, public string $event) {}

    public function handle(DatabaseTenantContext $tenantContext, DeskCustomerDirectory $directory, TwilioSms $sms): void
    {
        $order = Order::query()->whereKey($this->orderId)->first();

        if (! $order instanceof Order || $order->customer_account_id === null) {
            return;
        }

        $account = $tenantContext->during(null, $order->organisation_id, null, fn (): ?CustomerAccount => CustomerAccount::query()
            ->whereKey($order->customer_account_id)
            ->first());

        if (! $account instanceof CustomerAccount) {
            return;
        }

        $contacts = collect($directory->contactPointsFor([$account])[(string) $account->getKey()] ?? []);
        $email = $contacts->firstWhere('channel', 'email');
        $phone = $contacts->firstWhere('channel', 'phone');
        $locale = $this->locale($account, $order);

        $event = CustomerOrderEvent::from($this->event);
        $key = "notices.order.{$event->value}";
        $details = ['number' => $order->order_number, 'kitchen' => $this->kitchenName($order)];
        $heading = (string) __("{$key}.heading", $details, $locale);

        if ($email !== null) {
            try {
                Mail::to($email['value'])->sendNow(new NoticeMessage(
                    "order_{$event->value}",
                    $heading,
                    [(string) __("{$key}.body", $details, $locale)],
                    $account->user_id === null ? null : (string) __('notices.order.action', [], $locale),
                    $account->user_id === null ? null : rtrim((string) config('app.frontend_url'), '/').'/customer/orders/'.$order->getKey(),
                    $locale,
                ));
            } catch (Throwable $e) {
                report($e);
            }
        }

        if ($phone !== null) {
            $sms->send($phone['value'], $heading);
        }
    }

    /** The account's own choice, then the person's, then the kitchen's. */
    private function locale(CustomerAccount $account, Order $order): string
    {
        $preferred = $account->preferred_language_code
            ?? ($account->user_id === null ? null : DB::table('user_profiles')->where('user_id', $account->user_id)->value('preferred_language_code'))
            ?? DB::table('organisations')->where('id', $order->organisation_id)->value('default_language_code');

        return $preferred === 'ar' ? 'ar' : 'en';
    }

    private function kitchenName(Order $order): string
    {
        return (string) DB::table('organisations')->where('id', $order->organisation_id)->value('name');
    }
}
