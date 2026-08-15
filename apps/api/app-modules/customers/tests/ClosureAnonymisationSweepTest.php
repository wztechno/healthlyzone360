<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Consent\Database\Seeders\ConsentDefinitionSeeder;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Customers\Closure\Enums\ClosureReasonCode;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Closure\Jobs\FinaliseAccountClosure;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Customers\Closure\Models\ClosedAccountTombstone;
use Healthy360\Customers\Closure\Services\AccountAnonymiser;
use Healthy360\Customers\Closure\Services\ClosureBlockerRegistry;
use Healthy360\Customers\Closure\Services\ClosureService;
use Healthy360\Customers\Closure\Services\OrderSnapshotAnonymiser;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Guest\Models\MarketingSuppression;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Enums\UserStatus;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Services\OrderSnapshotRedaction;
use Healthy360\Orders\Tests\Fixtures\OrderWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Verification\Models\OtpChallenge;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Erased, and still able to keep the books
|--------------------------------------------------------------------------
|
| A closure has to satisfy two obligations that pull against each other, and
| asserting either one alone is how implementations end up satisfying only that
| one. So this smoke asserts both in a single pass over a finalised account.
|
| **Forget me.** Every distinctive string this person gave the platform — their
| name, their email address, their phone number, their street, the label they
| typed for their own front door — is swept for across *every column of every
| table in the schema*. A column sweep rather than a list of expected tables,
| because the failure this catches is a column nobody thought of: the one added
| last month, in another module, that quietly holds a copy.
|
| **Keep the books.** The order rows survive with their numbers, their money
| and their dates, because a commercial and tax record has a retention of its
| own. The delivery *area* survives with them — it is what tax and coverage are
| computed on, and it is classified Public on that table — while the address
| lines that would take a courier to a door are gone.
|
| The order's address snapshot got **wider** when the Order Desk taught orders
| how they leave (`2026_08_15_003003`): the building, the floor, the flat, the
| customer's own free-text directions and a reference to the number the courier
| was given. Every one of them is filled in below with a literal of this
| person's own, because the column sweep is only as good as the columns the
| fixture actually writes to — an untouched column is a column that trivially
| contains no literal, and a redaction that forgot it would pass. The directions
| field is the sharpest of the set: it is prose a customer wrote for a stranger
| who has to find them, and it is where a name, a neighbour or a habit ends up.
|
| Two more properties ride along, both of them the kind that decay silently:
|
|   * the tombstone holds hashes and only hashes, and the email hash still
|     answers "did this address ever have an account here" after every copy of
|     the address is gone;
|   * the address itself is *freed* — `users.email` is released so the same
|     person may register again (D-042) — which is the part an implementation
|     that merely nulled things would fail.
|
| **On the order anonymisation.** It runs through the `OrderAnonymisation`
| port. J2 wrote this file against `OrderSnapshotAnonymiser`, this module's
| documented fallback, and said that when the orders-module implementation
| landed the file would assert the same properties of that one without
| changing. It landed, and it did — the assertions below are untouched. The
| only addition is the case at the end, which pins *which* implementation is
| bound: the seam working as intended is worth an assertion of its own,
| because a lost binding would fall back to the fallback and every property
| here would still hold.
|
| SPEED MODE: one of the three kept smokes. See DEFERRED TESTS in the J2 report.
|
*/

beforeEach(function (): void {
    // The three the order suite seeds, and deliberately not the consent
    // definitions: this file places a real order, and a required consent left
    // outstanding is exactly what `CheckoutEligibility` refuses on. Consent
    // withdrawal at closure is asserted where it belongs — it moves no PII, and
    // seeding a catalogue here would only make the fixture unable to order.
    $this->seed([
        ReferenceDataSeeder::class,
        OrganisationTypeSeeder::class,
        AccessControlSeeder::class,
    ]);
});

it('sweeps every PII literal out of the schema while the order rows survive', function (): void {
    // A world with a real placed order, because "orders are retained" is half
    // of what is being asserted and a hand-built row would not prove the
    // placement path writes what the redaction has to find.
    $world = CheckoutWorld::build('closing@kitchen.test');
    $order = OrderWorld::place($world);

    $account = $world->customer->account;
    $user = $account->user;

    // The distinctive strings this person gave us. Every one of them is
    // deliberately unlike anything a fixture or a seeder would produce, so a
    // match anywhere in the schema is this person and not a coincidence.
    $email = 'zaraq-mulvaney@closure-sweep.test';
    $phone = '+96170998877';
    $givenName = 'Zaraq';
    $familyName = 'Mulvaney';
    $street = 'Quibbleworth Lane 4417';
    $label = 'Zaraq front door';
    // The widened half of the snapshot. Each one is a token nothing else in the
    // schema could produce, so a match anywhere is this person's address and not
    // a coincidence.
    $building = 'Blissmore Tower';
    $floor = 'Mezzanine Vantrell';
    $apartment = 'Flat Okonwe 12c';
    $directions = 'Green door past the Vellichor pharmacy, ring twice';

    DB::table('users')->where('id', $user->getKey())->update(['email' => $email]);

    UserProfile::factory()->create([
        'user_id' => $user->getKey(),
        'given_name' => $givenName,
        'family_name' => $familyName,
        'date_of_birth' => '1988-04-11',
    ]);

    // The world already gave this person a verified login contact; rewriting it
    // rather than adding a second, because `contact_points_login_identity_unique`
    // permits exactly one and the real journey never has two.
    $emailContact = ContactPoint::query()->where('user_id', $user->getKey())->firstOrFail();
    $emailContact->forceFill([
        'channel' => 'email',
        'value_normalised' => $email,
        'value_hash' => app(ContactValueHasher::class)->hash($email),
        'label' => null,
    ])->save();

    $phoneContact = ContactPoint::query()->create([
        'customer_account_id' => $account->getKey(),
        'channel' => 'phone',
        'value_normalised' => $phone,
        'value_hash' => app(ContactValueHasher::class)->hash($phone),
        'verified_at' => now(),
        'source' => 'self_service',
    ]);

    CustomerAddress::query()->where('customer_account_id', $account->getKey())->update([
        'line_one' => $street,
        'label' => $label,
    ]);

    // Special-category data: the row that matters most in the list. The world
    // already declared one, so this puts a person's name into its free-text
    // note — the field a sweep of "expected tables" would never think to check.
    CustomerDietaryProfile::query()
        ->where('customer_account_id', $account->getKey())
        ->update(['notes' => $familyName.' avoids shellfish']);

    // The order carries its own snapshot of the address, taken at placement.
    //
    // It is also marked fulfilled, and that is not a convenience: an order in
    // flight *blocks* a closure, which is `OpenOrdersBlocker` doing its job and
    // is asserted in the blocker smoke. The state this file is about is the one
    // after the last delivery has arrived — the moment somebody is finally
    // allowed to leave, and the moment their address must stop existing while
    // the invoice does not.
    DB::table('orders')->where('id', $order->getKey())->update([
        'delivery_line_one' => $street,
        'delivery_label' => $label,
        'delivery_building' => $building,
        'delivery_floor' => $floor,
        'delivery_apartment' => $apartment,
        'delivery_directions' => $directions,
        'delivery_contact_point_id' => $phoneContact->getKey(),
        'status' => OrderStatus::Fulfilled->value,
        'fulfilled_at' => now(),
    ]);

    $orderNumber = (string) $order->order_number;
    $orderTotal = (int) $order->total_minor;
    $orderAreaId = $order->delivery_area_id;
    $orderCity = $order->delivery_city;
    $emailDigest = app(ContactValueHasher::class)->hash($email);

    $request = AccountClosureRequest::query()->create([
        'user_id' => $user->getKey(),
        'customer_account_id' => $account->getKey(),
        'reason_code' => ClosureReasonCode::PrivacyConcerns->value,
        'reason_note' => $givenName.' asked for everything to go',
        'scope' => ClosureScope::Full->value,
        'status' => ClosureRequestStatus::Scheduled->value,
        'requested_at' => now(),
        'verified_at' => now(),
        'scheduled_for' => now(),
        // The proof CHECK demands a challenge on a full closure past
        // `requested`; this is the one the customer verified against.
        'otp_challenge_id' => OtpChallenge::factory()->create([
            'contact_point_id' => $emailContact->getKey(),
            'user_id' => $user->getKey(),
            'customer_account_id' => null,
            'purpose' => 'closure_step_up',
            'status' => 'verified',
            'verified_at' => now(),
            'finished_at' => now(),
        ])->getKey(),
    ]);

    app(FinaliseAccountClosure::class, ['closureRequestId' => (string) $request->getKey()])
        ->handle(
            app(AccountAnonymiser::class),
            app(ClosureBlockerRegistry::class),
            app(ClosureService::class),
            app(AuditRecorder::class),
        );

    // ---------------------------------------------------------------- forget

    $literals = [$email, $phone, $givenName, $familyName, $street, $label, $building, $floor, $apartment, $directions];
    $hits = [];

    foreach (textColumnsInSchema() as [$table, $column]) {
        foreach ($literals as $literal) {
            $found = DB::table($table)
                ->whereRaw("CAST({$column} AS TEXT) ILIKE ?", ['%'.$literal.'%'])
                ->count();

            if ($found > 0) {
                $hits[] = "{$table}.{$column} still contains '{$literal}'";
            }
        }
    }

    expect($hits)->toBe([], "Personal data survived the closure:\n".implode("\n", $hits));

    // The rows that hold nothing but personal data are gone outright, exactly
    // as the guest purge deletes them.
    expect(ContactPoint::query()->where('user_id', $user->getKey())->exists())->toBeFalse()
        ->and(ContactPoint::query()->where('customer_account_id', $account->getKey())->exists())->toBeFalse()
        ->and(CustomerAddress::query()->where('customer_account_id', $account->getKey())->exists())->toBeFalse()
        ->and(CustomerDietaryProfile::query()->where('customer_account_id', $account->getKey())->exists())->toBeFalse();

    // The identity survives, anonymised — it is the join target everything
    // retained still points at — and its address has been *freed*, which is
    // the part a "null everything" implementation gets wrong.
    $user->refresh();
    expect($user->status)->toBe(UserStatus::Closed)
        ->and($user->anonymised_at)->not->toBeNull()
        ->and($user->email)->toEndWith('@'.AccountAnonymiser::ANONYMISED_DOMAIN)
        ->and($user->email)->not->toBe($email)
        ->and($user->two_factor_secret)->toBeNull()
        ->and($user->email_verified_at)->toBeNull();

    $account->refresh();
    expect($account->status)->toBe(CustomerAccountStatus::Closed)
        ->and($account->anonymised_at)->not->toBeNull()
        ->and($account->display_name)->toBeNull();

    // ------------------------------------------------------------ keep books

    $retained = DB::table('orders')->where('id', $order->getKey())->first();

    expect($retained)->not->toBeNull()
        ->and($retained->order_number)->toBe($orderNumber)
        ->and((int) $retained->total_minor)->toBe($orderTotal)
        ->and($retained->placed_at)->not->toBeNull()
        // Area and city stay: the district is what tax and coverage are
        // computed on and is Public on this table.
        ->and($retained->delivery_area_id)->toBe($orderAreaId)
        ->and($retained->delivery_city)->toBe($orderCity)
        // The street does not.
        ->and($retained->delivery_line_one)->not->toBe($street)
        ->and($retained->delivery_label)->toBeNull()
        // Nor does the rest of the way to the door. The sweep above already
        // proves the *strings* are gone; these say the columns were emptied
        // rather than overwritten with something else that merely fails to
        // match.
        ->and($retained->delivery_building)->toBeNull()
        ->and($retained->delivery_floor)->toBeNull()
        ->and($retained->delivery_apartment)->toBeNull()
        ->and($retained->delivery_directions)->toBeNull()
        // Two mechanisms converge on this one and only one of them is the
        // redaction: the contact point is deleted outright by the closure and
        // the foreign key is `nullOnDelete`, so the column would empty itself
        // even if nothing cleared it. The redaction clears it anyway, because a
        // redaction that depended on deletion order would be a redaction that
        // stopped working the day the order of the two changed.
        ->and($retained->delivery_contact_point_id)->toBeNull();

    // ------------------------------------------------------------- tombstone

    $tombstone = ClosedAccountTombstone::query()->where('user_id', $user->getKey())->first();

    expect($tombstone)->not->toBeNull()
        // Still answers "did this address ever have an account here", with no
        // copy of the address anywhere.
        ->and($tombstone->email_hash)->toBe($emailDigest)
        ->and($tombstone->phone_hashes)->toHaveCount(1)
        ->and($tombstone->reason_code)->toBe(ClosureReasonCode::PrivacyConcerns);

    // The one thing an erasure is allowed to leave behind, so the next import
    // cannot silently undo it.
    expect(MarketingSuppression::query()->count())->toBeGreaterThan(0);

    $request->refresh();
    expect($request->status)->toBe(ClosureRequestStatus::Completed)
        ->and($request->reason_note)->toBeNull();
});

it('is safe to run twice', function (): void {
    $world = CheckoutWorld::build('twice@kitchen.test');
    $account = $world->customer->account;
    $user = $account->user;

    $request = AccountClosureRequest::query()->create([
        'user_id' => $user->getKey(),
        'customer_account_id' => $account->getKey(),
        'reason_code' => ClosureReasonCode::NoLongerNeeded->value,
        'scope' => ClosureScope::Full->value,
        'status' => ClosureRequestStatus::Scheduled->value,
        'requested_at' => now(),
        'verified_at' => now(),
        'scheduled_for' => now(),
        'otp_challenge_id' => OtpChallenge::factory()->create([
            'user_id' => $user->getKey(),
            'customer_account_id' => null,
            'purpose' => 'closure_step_up',
            'status' => 'verified',
            'verified_at' => now(),
            'finished_at' => now(),
        ])->getKey(),
    ]);

    $anonymiser = app(AccountAnonymiser::class);

    $first = $anonymiser->anonymise($user->refresh(), $account, $request);
    $second = $anonymiser->anonymise($user->refresh(), $account->refresh(), $request);

    expect($first->tombstoneWritten)->toBeTrue()
        // The tombstone's unique index is the idempotence guard, and the second
        // run is a queue retry after a timeout — the normal case, not the
        // exceptional one.
        ->and($second->tombstoneWritten)->toBeFalse()
        ->and($second->userAnonymised)->toBeTrue()
        ->and(ClosedAccountTombstone::query()->where('user_id', $user->getKey())->count())->toBe(1);
});

it('takes the reversible half without deleting anything', function (): void {
    // The other branch of the same journey and the same screen. Cheap to
    // assert and expensive to get wrong: a marketing opt-out that quietly
    // deleted something would be an erasure nobody consented to, and one that
    // wrote no suppression would be silently undone by the next list import.
    $this->seed([ConsentDefinitionSeeder::class]);

    $account = CustomerAccount::factory()->active()->create();
    $user = $account->user;

    ContactPoint::factory()->verified()->create([
        'user_id' => $user->getKey(),
        'is_login_identity' => true,
        'is_primary' => true,
    ]);

    // `web` because `consent_grants.channel` is a CHECK'd vocabulary of
    // web|ios|android — this is a person ticking two boxes on a form.
    app(ConsentLedger::class)->grant($user, ClosureService::MARKETING_CONSENT_CODES, 'web');

    $acknowledgement = app(ClosureService::class)->request(
        $user,
        ClosureReasonCode::TooExpensive,
        ClosureScope::MarketingOptOut,
    );

    // Done by the time the page reloads, with no passcode: there is nothing
    // irreversible here to protect, and friction on the reversible choice is
    // how people are pushed toward the irreversible one.
    expect($acknowledgement->status)->toBe(ClosureRequestStatus::Completed)
        ->and($acknowledgement->verificationRequired)->toBeFalse()
        ->and($acknowledgement->isBlocked())->toBeFalse();

    expect(app(ConsentLedger::class)->grantedCodesFor($user))
        ->not->toContain('consent.marketing_email')
        ->not->toContain('consent.marketing_whatsapp');

    // The durable half. A withdrawn grant is a row on this platform; the
    // suppression is what the next import from anywhere else has to consult.
    expect(MarketingSuppression::query()->count())->toBe(1);

    // And nothing was erased.
    $user->refresh();
    expect($user->status)->not->toBe(UserStatus::Closed)
        ->and($user->anonymised_at)->toBeNull()
        ->and(ContactPoint::query()->where('user_id', $user->getKey())->exists())->toBeTrue();
});

it('runs the orders module implementation of the port rather than the fallback', function (): void {
    // The seam closed, pinned. Every property this file asserts holds for
    // `OrderSnapshotAnonymiser` too — it was written to hold for both — so a
    // lost binding would leave the sweep green while the redaction ran through
    // a schema-guarded stand-in that nobody maintains. This is the one
    // assertion that would notice.
    $bound = app(OrderAnonymisation::class);

    expect($bound)->toBeInstanceOf(OrderSnapshotRedaction::class)
        ->and($bound->isAvailable())->toBeTrue()
        // The two implementations agree on the marker on purpose: rows redacted
        // before the wave carry it, and a second marker would make "was this
        // order redacted" a question with two answers.
        ->and(OrderSnapshotRedaction::REDACTED)->toBe(OrderSnapshotAnonymiser::REDACTED);
});

/**
 * Every text-ish column in the schema, as [table, column] pairs.
 *
 * A sweep rather than a list, because the leak this catches is the column
 * nobody thought of. Declared as a function with a distinctive name for the
 * reason every fixture in this codebase is a class: Pest loads the whole suite
 * into one process.
 *
 * @return list<array{0: string, 1: string}>
 */
function textColumnsInSchema(): array
{
    /** @var list<object{table_name: string, column_name: string}> $rows */
    $rows = DB::table('information_schema.columns')
        ->where('table_schema', 'public')
        ->whereIn('data_type', ['character varying', 'text', 'character', 'jsonb', 'json'])
        ->get(['table_name', 'column_name'])
        ->all();

    return array_map(
        static fn (object $row): array => [$row->table_name, '"'.$row->column_name.'"'],
        $rows,
    );
}
