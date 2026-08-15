<?php

declare(strict_types=1);

use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Guest\Enums\SuppressionKind;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Models\MarketingSuppression;
use Healthy360\Customers\Guest\Services\GuestDeletionService;
use Healthy360\Customers\Guest\Services\GuestSessionService;
use Healthy360\Customers\Guest\Services\MarketingSuppressionRegistry;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;

/*
|--------------------------------------------------------------------------
| The one thing an erasure is allowed to leave behind
|--------------------------------------------------------------------------
|
| "Delete everything about me" and "never contact me again" are the same request
| from the person's side and contradictory from ours: honouring the first
| perfectly means forgetting the second was ever asked, and the next import
| silently re-adds them. The resolution is a suppression hash — a digest with no
| plaintext, no foreign key and no way back to a person, kept precisely so the
| erasure does not undo itself.
|
| So this smoke asserts a purge in both directions at once:
|
|   * everything identifying is gone — contacts, addresses, the dietary cluster
|     (special-category data, the most important row in the list), sessions —
|     and the account row is closed and anonymised rather than deleted, because
|     it is the join target the retained order records need;
|   * the suppression survives, matches the digest the *live* contact carried
|     before deletion, and still answers "must this address be contacted" after
|     every trace of the address is gone.
|
| SPEED MODE: one of three kept smokes. See DEFERRED TESTS in the G1 report.
|
*/

it('erases a guest but keeps the suppression that stops the erasure undoing itself', function (): void {
    $guest = app(GuestSessionService::class)->start();
    $account = $guest->account;

    $contact = app(ContactPointRegistry::class)->rememberForCustomerAccount(
        customerAccountId: (string) $account->getKey(),
        channel: ContactChannel::Email,
        value: 'forget-me@example.test',
    );

    // The digest the suppression must end up matching, captured while the
    // contact still exists.
    $digest = $contact->value_hash;

    CustomerDietaryProfile::query()->create([
        'customer_account_id' => $account->getKey(),
        'declared_at' => now(),
    ]);

    expect(ContactPoint::query()->where('customer_account_id', $account->getKey())->count())->toBe(1)
        ->and(GuestSession::query()->where('customer_account_id', $account->getKey())->count())->toBe(1);

    $report = app(GuestDeletionService::class)->purge($account);

    // Everything identifying is gone.
    expect(ContactPoint::query()->where('customer_account_id', $account->getKey())->exists())->toBeFalse()
        ->and(GuestSession::query()->where('customer_account_id', $account->getKey())->exists())->toBeFalse()
        ->and(CustomerDietaryProfile::query()->where('customer_account_id', $account->getKey())->exists())->toBeFalse()
        ->and($report->contactsDeleted)->toBe(1)
        ->and($report->sessionsDeleted)->toBe(1)
        ->and($report->suppressionsWritten)->toBe(1)
        ->and($report->accountAnonymised)->toBeTrue();

    // The account row survives, closed and anonymised — the join target the
    // retained order records need, carrying nothing that names a person.
    $anonymised = CustomerAccount::query()->whereKey($account->getKey())->first();

    expect($anonymised)->not->toBeNull()
        ->and($anonymised?->status)->toBe(CustomerAccountStatus::Closed)
        ->and($anonymised?->closed_at)->not->toBeNull()
        ->and($anonymised?->anonymised_at)->not->toBeNull()
        ->and($anonymised?->display_name)->toBeNull()
        ->and($anonymised?->guest_expires_at)->toBeNull();

    // And the suppression outlives all of it — the same digest, still
    // answering the only question it exists to answer.
    $suppression = MarketingSuppression::query()->where('contact_hash', $digest)->first();

    expect($suppression)->not->toBeNull()
        ->and($suppression?->kind)->toBe(SuppressionKind::Email)
        ->and($suppression?->source)->toBe(SuppressionSource::Deletion)
        ->and(app(MarketingSuppressionRegistry::class)->isSuppressed(ContactChannel::Email, 'forget-me@example.test'))->toBeTrue();
});
