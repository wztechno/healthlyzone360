<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Http\Controllers;

use Healthy360\QualityControl\Models\QualityCheck;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The checks, each named by what it holds rather than by its subject's id.
 *
 * `subject_id` is a soft reference, so the names are read with two batched
 * queries over the tables directly — never a model import from procurement or
 * production — and a subject that no longer resolves simply has no label.
 */
final class QualityCheckIndexController
{
    public function __invoke(): JsonResponse
    {
        $checks = QualityCheck::query()->orderByDesc('created_at')->limit(50)->get();

        $receipts = $this->receipts($checks->where('subject_type', 'goods_receipt')->pluck('subject_id'));
        $batches = $this->batches($checks->where('subject_type', 'production_order')->pluck('subject_id'));

        return ApiResponse::data(['quality_checks' => $checks->map(function (QualityCheck $c) use ($receipts, $batches): array {
            $subject = $c->subject_type === 'goods_receipt'
                ? ($receipts[$c->subject_id] ?? null)
                : ($batches[$c->subject_id] ?? null);

            return [
                'id' => (string) $c->getKey(),
                'subject_type' => $c->subject_type,
                'subject_id' => $c->subject_id,
                'subject_label' => $subject['label'] ?? null,
                'subject_detail' => $subject['detail'] ?? null,
                'status' => $c->status,
            ];
        })->values()]);
    }

    /**
     * A delivery: the supplier and the invoice (or the delivery note), and what came in.
     *
     * @param  Collection<int, mixed>  $ids
     * @return array<string, array{label: string|null, detail: string|null}>
     */
    private function receipts(Collection $ids): array
    {
        if ($ids->isEmpty()) {
            return [];
        }

        $rows = DB::table('goods_receipts as r')
            ->leftJoin('suppliers as s', 's.id', '=', 'r.supplier_id')
            ->whereIn('r.id', $ids->all())
            ->get(['r.id', 's.name_en as supplier', 'r.supplier_invoice_ref', 'r.document_ref']);

        $items = DB::table('goods_receipt_lines as l')
            ->join('stock_items as i', 'i.id', '=', 'l.stock_item_id')
            ->whereIn('l.goods_receipt_id', $ids->all())
            ->orderBy('i.name_en')
            ->get(['l.goods_receipt_id', 'i.name_en'])
            ->groupBy('goods_receipt_id');

        $out = [];

        foreach ($rows as $row) {
            $reference = $row->supplier_invoice_ref ?? $row->document_ref;
            $names = ($items[$row->id] ?? collect())->pluck('name_en')->unique()->values();

            $out[(string) $row->id] = [
                'label' => implode(' · ', array_filter([$row->supplier, $reference])) ?: null,
                'detail' => $names->isEmpty() ? null : $names->take(3)->implode(', ').($names->count() > 3 ? ' +'.($names->count() - 3) : ''),
            ];
        }

        return $out;
    }

    /**
     * A batch: its work-order number or lot, and the recipe it cooks.
     *
     * @param  Collection<int, mixed>  $ids
     * @return array<string, array{label: string|null, detail: string|null}>
     */
    private function batches(Collection $ids): array
    {
        if ($ids->isEmpty()) {
            return [];
        }

        $rows = DB::table('production_orders as o')
            ->leftJoin('recipe_versions as v', 'v.id', '=', 'o.recipe_version_id')
            ->leftJoin('recipes as r', 'r.id', '=', 'v.recipe_id')
            ->whereIn('o.id', $ids->all())
            ->get(['o.id', 'o.reference', 'o.lot_number', 'r.name_en as recipe']);

        $out = [];

        foreach ($rows as $row) {
            $out[(string) $row->id] = [
                'label' => $row->lot_number ?? $row->reference ?? $row->recipe,
                'detail' => $row->recipe,
            ];
        }

        return $out;
    }
}
