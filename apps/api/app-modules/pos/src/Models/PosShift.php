<?php

declare(strict_types=1);

namespace Healthy360\POS\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A till shift — one cashier at one register between opening and closing.
 *
 * **Organisation-scoped, and it carries the column rather than borrowing the
 * register's.** The shift is the identifier a counter sale names, and an
 * unscoped `whereKey()` on it resolved any kitchen's shift for any caller,
 * which wrote the sale against the *caller's* organisation and the other
 * kitchen's shift. Reaching the owner through `pos_register_id` would have
 * closed the hole and left the join as the only thing standing between the
 * two, in a table the till writes to all day; the platform's answer everywhere
 * else is a column and a global scope, and this is not the table to be novel
 * in.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $pos_register_id
 * @property string $opened_by
 */
class PosShift extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'opened_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<PosRegister, $this>
     */
    public function register(): BelongsTo
    {
        return $this->belongsTo(PosRegister::class, 'pos_register_id');
    }
}
