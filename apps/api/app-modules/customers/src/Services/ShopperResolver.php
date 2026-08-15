<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\Services\ContextValidator;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;

/**
 * Which customer account an authenticated identity is shopping as.
 *
 * When the request carries an organisation context and the person is a member
 * of it, the corporate buyer account for that organisation wins. Otherwise the
 * person's own consumer account is used — the shape every B2C and guest path
 * has always assumed.
 *
 * Cart and order routes deliberately do **not** require `org.context` (B2C
 * shoppers have no organisation header). For B2B checkout the client still
 * sends `X-Organisation-Id`; this resolver validates membership the same way
 * `org.context` would, without forcing every basket open to carry a tenant.
 */
final readonly class ShopperResolver
{
    public function __construct(
        private TenantContext $context,
        private ContextValidator $validator,
        private Request $request,
    ) {}

    /**
     * @throws ApiException
     */
    public function resolve(): CustomerAccount
    {
        $userId = $this->context->userId();

        if ($userId === null) {
            throw new ApiException(
                ErrorCode::AccountVerificationRequired,
                'You do not have a customer account yet.',
                ['outstanding' => ['customer_account_missing']],
            );
        }

        $organisationId = $this->context->organisationId();
        $membership = $this->context->membership();

        if ($organisationId === null) {
            $header = $this->request->header('X-Organisation-Id');
            $user = $this->request->user();
            $membership = $this->validator->findMembership($user, is_string($header) ? $header : null);

            if ($membership !== null) {
                $organisationId = (string) $membership->organisation_id;
                $this->context->setOrganisation($userId, $organisationId, $membership);
            }
        }

        if ($organisationId !== null && $membership !== null) {
            $corporate = CustomerAccount::query()
                ->where('organisation_id', $organisationId)
                ->where('account_type', CustomerAccountType::B2b->value)
                ->first();

            if ($corporate instanceof CustomerAccount) {
                return $corporate;
            }
        }

        $account = CustomerAccount::query()
            ->where('user_id', $userId)
            ->where('account_type', CustomerAccountType::B2c->value)
            ->first();

        if (! $account instanceof CustomerAccount) {
            throw new ApiException(
                ErrorCode::AccountVerificationRequired,
                'You do not have a customer account yet.',
                ['outstanding' => ['customer_account_missing']],
            );
        }

        return $account;
    }
}
