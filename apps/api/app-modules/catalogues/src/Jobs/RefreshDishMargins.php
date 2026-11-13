<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Jobs;

use Healthy360\Catalogues\Services\DishMargins;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Throwable;

/**
 * Recost every trading kitchen's dishes overnight, and alert on the ones the cost
 * moved below target.
 *
 * Each kitchen runs inside its own `during()`, for the reason
 * `EscalateUnacceptedOrders` gives, and one kitchen's failure stops nobody else's.
 */
final class RefreshDishMargins implements ShouldQueue
{
    use Queueable;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(DatabaseTenantContext $database, TenantContext $context, DishMargins $margins): void
    {
        $ambient = $context->toArray();

        try {
            foreach ($this->tradingKitchens() as $organisationId) {
                try {
                    $database->during(null, $organisationId, null, function () use ($context, $margins, $organisationId): void {
                        $context->restore(['user_id' => null, 'organisation_id' => $organisationId, 'branch_id' => null]);

                        $margins->refresh($organisationId);
                    });
                } catch (Throwable $e) {
                    report($e);
                }
            }
        } finally {
            $context->restore($ambient);
        }
    }

    /**
     * @return list<string>
     */
    private function tradingKitchens(): array
    {
        return array_values(Organisation::query()
            ->orderBy('id')
            ->get(['id', 'status'])
            ->filter(static fn (Organisation $organisation): bool => $organisation->status->isTrading())
            ->map(static fn (Organisation $organisation): string => (string) $organisation->getKey())
            ->values()
            ->all());
    }
}
