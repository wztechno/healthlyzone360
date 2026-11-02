<?php

declare(strict_types=1);

use App\Models\User;
use App\Services\NoticeRecipients;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Mail\NoticeMessage;
use Healthy360\Support\Models\StaffNotification;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Database\QueryException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| StaffAlerts: bell row, email, SMS
|--------------------------------------------------------------------------
|
| Deferred delivery runs inline here (`withoutDefer`), so what a test sees
| queued is what would leave after the response. `DB::afterCommit` still waits
| for the commit, because the test manager ignores only the suite's own wrapping
| transaction. The sync queue runs the SMS job inline.
|
*/

const STAFF_ALERT_ORDER = ['order_number' => 'H-1001', 'total_minor' => 2500, 'currency_code' => 'USD'];

/**
 * An active member of the organisation on a role of this code, holding these
 * permissions.
 *
 * @param  list<string>  $permissions
 */
function staffMember(string $organisationId, string $roleCode, array $permissions = [], string $locale = 'en'): User
{
    $user = User::factory()->create();

    UserProfile::factory()->create(['user_id' => $user->getKey(), 'preferred_language_code' => $locale]);

    $role = Role::factory()->create(['organisation_id' => $organisationId, 'code' => $roleCode]);

    foreach ($permissions as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisationId,
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
    ]);

    MembershipRole::factory()->create([
        'membership_id' => $membership->getKey(),
        'organisation_id' => $organisationId,
        'role_id' => $role->getKey(),
    ]);

    return $user;
}

function staffManager(string $organisationId, string $locale = 'en'): User
{
    return staffMember($organisationId, 'manager_'.Str::lower(Str::random(6)), ['order.supervise_organisation'], $locale);
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    Http::fake(['api.twilio.com/*' => Http::response(['sid' => 'SM1'], 201)]);
    $this->withoutDefer();
    config(['services.twilio' => ['sid' => 'ACtest', 'token' => 'token', 'from' => '+15005550006']]);

    $this->organisationId = (string) CatalogueWorld::organisation()->getKey();
    $this->subjectId = (string) Str::uuid7();
    $this->alerts = app(StaffAlerts::class);
});

it('writes one row per manager', function (): void {
    $first = staffManager($this->organisationId);
    $second = staffManager($this->organisationId);
    staffMember($this->organisationId, 'cook_role');

    $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    $rows = StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->get();

    expect($rows->pluck('user_id')->all())->toEqualCanonicalizing([$first->getKey(), $second->getKey()])
        ->and($rows->first()->type)->toBe('allergy_order')
        ->and($rows->first()->subject_type)->toBe('order')
        ->and($rows->first()->organisation_id)->toBe($this->organisationId)
        ->and($rows->first()->data)->toEqual(STAFF_ALERT_ORDER);
});

it('does not alert twice for one order and type', function (): void {
    ContactPoint::factory()->phone()->create(['user_id' => staffManager($this->organisationId)->getKey()]);

    $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);
    $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    expect(StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->count())->toBe(1);
    Mail::assertQueued(NoticeMessage::class, 1);
    Http::assertSentCount(1);
});

it('alerts a manager who joins after the first alert, and only them', function (): void {
    staffManager($this->organisationId);
    $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    $late = staffManager($this->organisationId);
    $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    Mail::assertQueued(NoticeMessage::class, 2);
    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->hasTo($late->email));
});

it('brings a repeat delivery failure back unread and mails it again', function (): void {
    staffManager($this->organisationId);
    $row = fn (): StaffNotification => StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->sole();

    $this->alerts->send(StaffAlertType::DeliveryFailed, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    $first = $row()->created_at;
    StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->update(['read_at' => now()]);
    $this->travel(5)->minutes();

    RuntimeRole::context();
    RuntimeRole::run(fn () => $this->alerts->send(StaffAlertType::DeliveryFailed, $this->organisationId, $this->subjectId, [...STAFF_ALERT_ORDER, 'total_minor' => 3000]));

    expect($row()->read_at)->toBeNull()
        ->and($row()->created_at->greaterThan($first))->toBeTrue()
        ->and($row()->data['total_minor'])->toBe(3000);

    Mail::assertQueued(NoticeMessage::class, 2);
});

it('leaves out a member whose role has expired or not started', function (): void {
    $current = staffManager($this->organisationId);
    $expired = staffManager($this->organisationId);
    $future = staffManager($this->organisationId);

    $roleOf = fn (User $user) => DB::table('membership_roles')
        ->whereIn('membership_id', DB::table('organisation_memberships')->where('user_id', $user->getKey())->select('id'));

    $roleOf($expired)->update(['expires_at' => now()->subMinute()]);
    $roleOf($future)->update(['starts_at' => now()->addDay()]);

    $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    expect(StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->pluck('user_id')->all())
        ->toBe([$current->getKey()]);
});

it('queues mail in each recipient\'s locale after commit', function (): void {
    $english = staffManager($this->organisationId);
    $arabic = staffManager($this->organisationId, 'ar');

    DB::transaction(function (): void {
        $this->alerts->send(StaffAlertType::NoCashCollected, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

        Mail::assertNothingQueued();
    });

    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->hasTo($english->email)
        && $mail->locale === 'en'
        && $mail->kind === 'staff_alert_no_cash_collected'
        && $mail->heading === 'No cash was collected for order H-1001'
        && in_array('Order total: 25.00 USD.', $mail->lines, true)
        && str_ends_with((string) $mail->actionUrl, '/kitchen/orders?view='.$this->subjectId));

    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => $mail->hasTo($arabic->email)
        && $mail->locale === 'ar'
        && $mail->heading === 'لم يُحصَّل أي نقد عن الطلب H-1001');
});

it('renders every alert\'s words in both languages', function (StaffAlertType $type, string $locale): void {
    staffManager($this->organisationId, $locale);
    staffMember($this->organisationId, 'organisation_owner', locale: $locale);

    $this->alerts->send($type, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    Mail::assertQueued(NoticeMessage::class, fn (NoticeMessage $mail): bool => str_contains($mail->heading, 'H-1001')
        && ! str_contains($mail->heading, 'notices.')
        && ! str_contains($mail->lines[0], 'notices.'));
})->with(StaffAlertType::cases())->with(['en', 'ar']);

it('a rolled-back transaction mails nobody', function (): void {
    $manager = staffManager($this->organisationId);
    ContactPoint::factory()->phone()->create(['user_id' => $manager->getKey()]);

    expect(fn () => DB::transaction(function (): void {
        $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

        throw new RuntimeException('The order was refused.');
    }))->toThrow(RuntimeException::class);

    expect(StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->count())->toBe(0);
    Mail::assertNothingQueued();
    Http::assertNothingSent();
});

it('sends SMS only for escalation types', function (): void {
    $manager = staffManager($this->organisationId, 'ar');
    $phone = ContactPoint::factory()->phone()->create(['user_id' => $manager->getKey()]);

    $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);
    Http::assertNothingSent();

    $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    Http::assertSentCount(1);
    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json'
        && $request['To'] === $phone->value_normalised
        && $request['From'] === '+15005550006'
        && str_contains((string) $request['Body'], 'H-1001')
        && str_contains((string) $request['Body'], 'لم يُقبل'));
});

it('texts the primary number when a recipient has several', function (): void {
    $manager = staffManager($this->organisationId);
    ContactPoint::factory()->phone()->create(['user_id' => $manager->getKey()]);
    $primary = ContactPoint::factory()->phone()->create(['user_id' => $manager->getKey(), 'is_primary' => true]);

    $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    Http::assertSent(fn (Request $request): bool => $request['To'] === $primary->value_normalised);
});

it('sends nothing and logs once when Twilio is unconfigured', function (): void {
    config(['services.twilio.token' => null]);
    Log::spy();

    $manager = staffManager($this->organisationId);
    ContactPoint::factory()->phone()->create(['user_id' => $manager->getKey()]);

    $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    Http::assertNothingSent();
    Mail::assertQueued(NoticeMessage::class, 1);
    Log::shouldHaveReceived('warning')->with('SMS not sent: Twilio is not configured.', ['missing' => ['TWILIO_TOKEN']])->once();
});

it('a recipient with no phone gets no SMS', function (): void {
    staffManager($this->organisationId);

    $this->alerts->send(StaffAlertType::UnacceptedManager, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    Http::assertNothingSent();
    Mail::assertQueued(NoticeMessage::class, 1);
});

it('alerts the owner role and its copies, and no other role', function (string $roleCode, bool $alerted): void {
    $member = staffMember($this->organisationId, $roleCode);

    expect(array_column(app(NoticeRecipients::class)->owners($this->organisationId), 'user_id') === [(string) $member->getKey()])->toBe($alerted);
})->with([
    ['organisation_owner', true],
    ['organisation_owner_standard', true],
    ['organisation_owner_standard_2', true],
    ['organisation_owner_standard_13', true],
    ['organisation_owner_deputy', false],
    ['organisation_admin_standard', false],
]);

it('sends late cancels to the owner and not to managers', function (): void {
    $owner = staffMember($this->organisationId, 'organisation_owner_standard');
    staffManager($this->organisationId);

    $this->alerts->send(StaffAlertType::LateCancel, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER);

    expect(StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->pluck('user_id')->all())
        ->toBe([$owner->getKey()]);
});

it('keeps anything but the order number, money and severity out of the row', function (): void {
    staffManager($this->organisationId);

    $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, [
        'order_number' => 'H-1001',
        'severe' => true,
        'customer_name' => 'Layla',
        'allergy_note' => 'Peanuts',
    ]);

    expect(StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->sole()->data)
        ->toEqual(['order_number' => 'H-1001', 'severe' => true]);
});

it('sets the organisation itself when the caller has no tenant', function (): void {
    $manager = staffManager($this->organisationId);

    RuntimeRole::context();

    RuntimeRole::run(fn () => $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, $this->subjectId, STAFF_ALERT_ORDER));

    expect(StaffNotification::withoutTenancy()->where('subject_id', $this->subjectId)->pluck('user_id')->all())
        ->toBe([$manager->getKey()]);
    expect(RuntimeRole::setting('app.organisation_id'))->toBe('');
});

it('reports a failed alert and leaves the order\'s transaction usable', function (): void {
    Exceptions::fake();
    staffManager($this->organisationId);

    // Not a UUID, so the insert itself fails: unlike a repeat, ON CONFLICT does not absorb it.
    DB::transaction(function (): void {
        $this->alerts->send(StaffAlertType::AllergyOrder, $this->organisationId, 'not-a-uuid', STAFF_ALERT_ORDER);

        expect(DB::scalar('select 1'))->toBe(1);
    });

    Exceptions::assertReported(QueryException::class);
    Mail::assertNothingQueued();
    expect(app(DatabaseTenantContext::class)->applied()['organisation_id'])->toBe('')
        ->and(RuntimeRole::setting('app.organisation_id'))->toBe('');
});
