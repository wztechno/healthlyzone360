<?php

declare(strict_types=1);

namespace Healthy360\POS\Http\Controllers;

use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\POS\Models\PosShift;
use Healthy360\POS\Models\PosTransaction;
use Healthy360\POS\Models\PosTransactionLine;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class PosSaleStoreController
{
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'pos_shift_id' => ['required', 'uuid'],
            'payment_method_kind' => ['required', 'in:cash_on_delivery,card'],
            'currency_code' => ['required', 'string', 'size:3'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.catalogue_item_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'numeric', 'min:0.0001'],
            'lines.*.line_total_minor' => ['required', 'integer', 'min:0'],
        ]);

        $shift = PosShift::query()->whereKey($validated['pos_shift_id'])->firstOrFail();
        $total = array_sum(array_column($validated['lines'], 'line_total_minor'));
        $kind = PaymentMethodKind::from($validated['payment_method_kind']);

        $transaction = DB::transaction(function () use ($context, $shift, $validated, $total, $kind): PosTransaction {
            $transaction = PosTransaction::query()->create([
                'organisation_id' => $context->organisationId(),
                'pos_shift_id' => $shift->getKey(),
                'currency_code' => $validated['currency_code'],
                'total_minor' => $total,
                'payment_method_kind' => $kind->value,
                'status' => 'completed',
            ]);

            foreach ($validated['lines'] as $line) {
                PosTransactionLine::query()->create([
                    'pos_transaction_id' => $transaction->getKey(),
                    'catalogue_item_id' => $line['catalogue_item_id'],
                    'quantity' => $line['quantity'],
                    'line_total_minor' => $line['line_total_minor'],
                ]);
            }

            return $transaction;
        });

        return ApiResponse::data(['pos_transaction' => [
            'id' => (string) $transaction->getKey(),
            'total_minor' => $transaction->total_minor,
            'payment_method_kind' => $transaction->payment_method_kind,
        ]], status: 201);
    }
}
