<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Kitchens\Models\KitchenServiceSettings;
use Healthy360\Kitchens\Tests\Fixtures\KitchenWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A kitchen's service timings
|--------------------------------------------------------------------------
|
| Read by whoever edits them and by whoever works the display, written only by
| the first. One row per organisation, created on first read.
|
*/

const SERVICE_SETTINGS = [
    'order_lead_minutes' => 60,
    'alarm_after_minutes' => 3,
    'manager_alert_after_minutes' => 8,
    'owner_alert_after_minutes' => 15,
    // The form posts the limit with the rest, and unchanged it takes no extra code.
    'refund_approval_above_minor' => 5000,
];

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

/**
 * @param  list<string>  $permissions
 */
function settingsCaller(object $test, string $email, array $permissions): object
{
    $kitchen = KitchenWorld::kitchen($email, $permissions);
    $test->actingAs($kitchen->user);
    $test->headers = KitchenWorld::headers($kitchen);

    return $kitchen;
}

it('answers the defaults the first time it is read', function (): void {
    settingsCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->getJson('/api/v1/catalogue/kitchen-service-settings', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.order_lead_minutes', 120)
        ->assertJsonPath('data.alarm_after_minutes', 5)
        ->assertJsonPath('data.manager_alert_after_minutes', 10)
        ->assertJsonPath('data.owner_alert_after_minutes', 20);
});

it('lets the display read the timings on the order permission alone', function (): void {
    settingsCaller($this, 'orders@kitchen.test', ['order.manage_organisation']);

    $this->getJson('/api/v1/catalogue/kitchen-service-settings', $this->headers)->assertOk();
});

it('refuses a reader with neither permission', function (): void {
    settingsCaller($this, 'viewer@kitchen.test', ['catalogue.view_organisation']);

    $this->getJson('/api/v1/catalogue/kitchen-service-settings', $this->headers)
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied');
});

it('saves all four timings and audits what changed', function (): void {
    $kitchen = settingsCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', SERVICE_SETTINGS, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.order_lead_minutes', 60)
        ->assertJsonPath('data.owner_alert_after_minutes', 15);

    expect(KitchenServiceSettings::withoutTenancy()->where('organisation_id', $kitchen->organisation->getKey())->sole()->alarm_after_minutes)->toBe(3);

    $log = AuditLog::query()->where('action', 'kitchen.service_settings_updated')->sole();

    expect($log->metadata['changed_fields'])->toEqualCanonicalizing(['order_lead_minutes', 'alarm_after_minutes', 'manager_alert_after_minutes', 'owner_alert_after_minutes']);
});

it('refuses a write without the catalogue permission, even from a reader', function (): void {
    settingsCaller($this, 'orders@kitchen.test', ['order.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', SERVICE_SETTINGS, $this->headers)->assertForbidden();
});

it('refuses timings that make no sense', function (array $change, string $field): void {
    settingsCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', [...SERVICE_SETTINGS, ...$change], $this->headers)
        ->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => [$field]]]]);
})->with([
    'a negative lead' => [['order_lead_minutes' => -1], 'order_lead_minutes'],
    'a fractional lead' => [['order_lead_minutes' => 1.5], 'order_lead_minutes'],
    'an alarm at zero' => [['alarm_after_minutes' => 0], 'alarm_after_minutes'],
    'a manager alert at zero' => [['manager_alert_after_minutes' => 0], 'manager_alert_after_minutes'],
    'an owner alert at zero' => [['owner_alert_after_minutes' => 0], 'manager_alert_after_minutes'],
    'managers told with the owner' => [['manager_alert_after_minutes' => 15], 'manager_alert_after_minutes'],
    'managers told after the owner' => [['manager_alert_after_minutes' => 16], 'manager_alert_after_minutes'],
    'more than a week' => [['owner_alert_after_minutes' => 10081], 'owner_alert_after_minutes'],
]);

it('accepts a lead of nothing', function (): void {
    settingsCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', [...SERVICE_SETTINGS, 'order_lead_minutes' => 0], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.order_lead_minutes', 0);
});

it('keeps the refund limit from the manager it limits', function (): void {
    settingsCaller($this, 'manager@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', [...SERVICE_SETTINGS, 'refund_approval_above_minor' => 999_999], $this->headers)
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'order.approve_refund_organisation');

    $this->getJson('/api/v1/catalogue/kitchen-service-settings', $this->headers)
        ->assertJsonPath('data.refund_approval_above_minor', 5000);
});

it('keeps the price limit from the manager it limits', function (): void {
    settingsCaller($this, 'manager@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', [...SERVICE_SETTINGS, 'price_approval_above_percent' => 90], $this->headers)
        ->assertForbidden()
        ->assertJsonPath('error.details.permission', 'inventory.approve_payables_organisation');
});

it('lets a manager resend the limits unchanged with new timings', function (): void {
    settingsCaller($this, 'manager@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', [...SERVICE_SETTINGS, 'price_approval_above_percent' => null], $this->headers)
        ->assertOk();
});

it('lets whoever holds the approvals move the limits, and audits both ends', function (): void {
    settingsCaller($this, 'owner@kitchen.test', [
        'catalogue.manage_organisation',
        'order.approve_refund_organisation',
        'inventory.approve_payables_organisation',
    ]);

    $this->putJson('/api/v1/catalogue/kitchen-service-settings', [
        ...SERVICE_SETTINGS,
        'refund_approval_above_minor' => 7500,
        'price_approval_above_percent' => 15,
    ], $this->headers)->assertOk();

    $metadata = AuditLog::query()->where('action', 'kitchen.service_settings_updated')->sole()->metadata;

    // Flat `was_`/`now_` pairs: the audit redaction reads top-level keys only.
    expect($metadata['was_refund_approval_above_minor'])->toEqual(5000)
        ->and($metadata['now_refund_approval_above_minor'])->toEqual(7500)
        ->and($metadata['was_price_approval_above_percent'])->toBeNull()
        ->and($metadata['now_price_approval_above_percent'])->toEqual(15);
});
