<?php

declare(strict_types=1);

namespace Healthy360\Support\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One alert for one member of staff.
 *
 * The organisation policy says whose kitchen a row belongs to, not whose bell it
 * rings, so every read also filters on `user_id`. `(user_id, type, subject_id)`
 * is unique, which is what lets a repeated job alert nobody twice.
 *
 * `data` is what the bell needs to draw the row: the order number, money and a
 * severity flag. It never holds a customer's name, an allergy note or any other
 * personal data ({@see StaffAlerts}), and money is why it is classified above the
 * rest of the row.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $user_id
 * @property string $type
 * @property string $subject_type
 * @property string $subject_id
 * @property array<string, mixed> $data
 * @property CarbonImmutable|null $read_at
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::Confidential, 'data')]
#[Classified(DataClassification::Internal, 'organisation_id', 'user_id', 'type', 'subject_type', 'subject_id', 'read_at')]
class StaffNotification extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'data' => 'array',
            'read_at' => 'datetime',
        ];
    }
}
