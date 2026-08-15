<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Models;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Closure\Enums\ClosureReasonCode;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The marker a closure leaves behind.
 *
 * Every identifying column on this model is a peppered digest, which is why the
 * classification is `Confidential` rather than `Restricted`: a hash of an email
 * address is not the address, but it is still a token that answers a question
 * about one particular person, and treating it as public would invite it into a
 * projection.
 *
 * There is no relation to the user and no relation to the account — only
 * identifiers. That is the point of a gravestone: it stands after the thing is
 * gone, and an Eloquent relation would invite a caller to `->load()` a person
 * who has been forgotten on purpose.
 *
 * @property string $id
 * @property string $user_id
 * @property string|null $customer_account_id
 * @property string|null $closure_request_id
 * @property CarbonImmutable $closed_at
 * @property string $email_hash
 * @property list<string> $phone_hashes
 * @property ClosureReasonCode $reason_code
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read AccountClosureRequest|null $closureRequest
 */
#[Classified(DataClassification::Confidential, 'email_hash', 'phone_hashes')]
class ClosedAccountTombstone extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'closed_at' => 'datetime',
            'phone_hashes' => 'array',
            'reason_code' => ClosureReasonCode::class,
        ];
    }

    /**
     * @return BelongsTo<AccountClosureRequest, $this>
     */
    public function closureRequest(): BelongsTo
    {
        return $this->belongsTo(AccountClosureRequest::class, 'closure_request_id');
    }
}
