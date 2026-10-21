<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Operational notices (en) — App\Mail\NoticeMessage
|--------------------------------------------------------------------------
|
| Quotation life (B2bQuotationNotices) and the weekly stock check
| (StockSufficiencyCheckRunner). Short on purpose: each says what happened
| and links to the one screen where it is acted on.
|
*/

return [
    'quotation' => [
        'submitted' => [
            'heading' => 'New quotation request :reference from :buyer',
            'lines' => '{1} :count line to price.|[2,*] :count lines to price.',
            'delivery' => 'First delivery requested for :date.',
            'recurring' => 'The buyer wants this on a standing weekly schedule.',
            'note' => 'Their note: :note',
            'action' => 'Price the request',
        ],
        'quoted' => [
            'heading' => 'Your quotation :reference is priced',
            'total' => 'Quoted total: :total.',
            'expires' => 'The price holds until :date.',
            'action' => 'Review and accept',
        ],
        'accepted' => [
            'heading' => ':buyer accepted quotation :reference',
            'orders' => '{1} One order placed, for :date.|[2,*] :count weekly orders placed, the first for :date.',
            'action' => 'Open the order calendar',
        ],
        'declined' => [
            'heading' => ':buyer declined quotation :reference',
            'reason' => 'Their reason: :reason',
            'action' => 'Open quotations',
        ],
    ],
    'stock' => [
        'heading' => '{1} Weekly stock check: :count item short for :from – :to|[2,*] Weekly stock check: :count items short for :from – :to',
        'line' => ':name — short :short :unit, buy :buy :unit',
        'more' => '…and :count more.',
        'holes' => '{1} :count day has demand nobody could work out (a missing recipe or menu).|[2,*] :count days have demand nobody could work out (a missing recipe or menu).',
        'action' => 'Open the buy list',
    ],
];
