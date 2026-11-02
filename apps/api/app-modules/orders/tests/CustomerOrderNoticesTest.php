<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\CustomerOrderEvent;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Jobs\SendCustomerOrderNotice;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\Services\CustomerOrderNotices;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\TwilioSms;
use Healthy360\Support\Mail\NoticeMessage;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

/*
|--------------------------------------------------------------------------
| Telling the customer
|--------------------------------------------------------------------------
|
| Who hears what, in their language, and what must never go on the queue.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->withoutDefer();

    $this->world = DeskWorld::build('notices@kitchen.test');
    $this->order = Order::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'customer_account_id' => $this->world->customer->account->getKey(),
        'fulfilment_type' => FulfilmentType::Delivery,
    ]);
});

it('carries ids and nothing else on the queue', function (): void {
    Queue::fake();

    app(CustomerOrderNotices::class)->send($this->order, CustomerOrderEvent::Confirmed);

    Queue::assertPushed(SendCustomerOrderNotice::class, function (SendCustomerOrderNotice $job): bool {
        return $job->orderId === (string) $this->order->getKey() && $job->event === 'confirmed';
    });
});

it('tells nobody about a counter sale, or a pickup about a delivery', function (): void {
    Queue::fake();
    $notices = app(CustomerOrderNotices::class);

    $this->order->fulfilment_type = FulfilmentType::Counter;
    $notices->send($this->order, CustomerOrderEvent::Confirmed);

    $this->order->fulfilment_type = FulfilmentType::Pickup;
    $notices->send($this->order, CustomerOrderEvent::Delivered);

    Queue::assertNothingPushed();
});

it('still tells a pickup customer about a confirmation', function (): void {
    Queue::fake();

    $this->order->fulfilment_type = FulfilmentType::Pickup;
    app(CustomerOrderNotices::class)->send($this->order, CustomerOrderEvent::Confirmed);

    Queue::assertPushed(SendCustomerOrderNotice::class);
});

it('mails in the customer\'s language, right now, and texts the same heading', function (): void {
    Mail::fake();

    $account = CustomerAccount::query()->whereKey($this->order->customer_account_id)->firstOrFail();
    $account->forceFill(['preferred_language_code' => 'ar'])->save();

    $sms = app(TwilioSms::class);

    (new SendCustomerOrderNotice((string) $this->order->getKey(), 'delivered'))->handle(
        app(DatabaseTenantContext::class),
        app(DeskCustomerDirectory::class),
        $sms,
    );

    Mail::assertSent(NoticeMessage::class, static fn (NoticeMessage $mail): bool => $mail->locale === 'ar' && $mail->kind === 'order_delivered');
});
