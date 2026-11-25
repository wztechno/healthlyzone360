{{--
    The invitation an organisation's administrator sends from Add user.

    The same drawing as the platform's kitchen owner invitation
    (`platform-administration::mail.kitchen-owner-invitation`) — see that file
    for why it is plain HTML with tables, inline styles and written-out token
    hexes. A change to the look there has to be repeated here by hand. The
    differences are the copy (`invitation.member.*`) and the role chip, which
    names the role the organisation chose rather than always "Owner".
--}}
@php
    $start = $direction === 'rtl' ? 'right' : 'left';
    $end = $direction === 'rtl' ? 'left' : 'right';
    $body = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
    $display = "'Space Grotesk','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
@endphp
<!DOCTYPE html>
<html lang="{{ $locale }}" dir="{{ $direction }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>{{ __('invitation.member.subject', ['organisation' => $organisation], $locale) }}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f7fcf9;font-family:{!! $body !!};color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7fcf9;">
    <tr>
        <td align="center" style="padding:32px 16px;">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="{{ $direction }}" style="max-width:560px;border-radius:24px;overflow:hidden;border:1px solid #d1fae5;background:#ffffff;">

                {{-- The canopy band: the brand, then what this message is about. --}}
                <tr>
                    <td style="background:#0b3b26;padding:28px 32px 32px;text-align:{{ $start }};">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="{{ $direction }}">
                            <tr>
                                <td style="width:12px;vertical-align:middle;font-size:0;line-height:0;">
                                    <div style="width:12px;height:12px;border-radius:999px;background:#4ade80;font-size:0;line-height:0;"></div>
                                </td>
                                <td style="padding-{{ $start }}:10px;font-family:{!! $display !!};font-size:18px;font-weight:700;color:#ffffff;">
                                    {{ config('app.name') }}
                                </td>
                            </tr>
                        </table>
                        <h1 style="margin:28px 0 0;font-family:{!! $display !!};font-size:30px;line-height:38px;font-weight:700;color:#ffffff;">
                            {{ __('invitation.member.heading', ['organisation' => $organisation], $locale) }}
                        </h1>
                    </td>
                </tr>

                <tr>
                    <td style="padding:32px;text-align:{{ $start }};">

                        <p style="margin:0 0 12px;font-size:16px;line-height:24px;font-weight:600;color:#1f2937;">
                            {{ __('invitation.member.greeting', [], $locale) }}
                        </p>

                        <p style="margin:0 0 24px;font-size:16px;line-height:24px;color:#5b6673;">
                            {{ __('invitation.member.intro', ['organisation' => $organisation, 'role' => $role, 'app' => config('app.name')], $locale) }}
                        </p>

                        {{-- The facts box, as the invitation page draws it. --}}
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="{{ $direction }}" style="margin:0 0 24px;border:1px solid #d1fae5;border-radius:16px;border-collapse:separate;background:#ffffff;">
                            <tr>
                                <td style="padding:14px 16px;font-size:14px;font-weight:500;color:#5b6673;text-align:{{ $start }};">
                                    {{ __('invitation.member.organisation_label', [], $locale) }}
                                </td>
                                <td style="padding:14px 16px;font-size:14px;font-weight:600;color:#1f2937;text-align:{{ $end }};">
                                    {{ $organisation }}
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:14px 16px;border-top:1px solid #e8f8ee;font-size:14px;font-weight:500;color:#5b6673;text-align:{{ $start }};">
                                    {{ __('invitation.member.role_label', [], $locale) }}
                                </td>
                                <td style="padding:14px 16px;border-top:1px solid #e8f8ee;text-align:{{ $end }};">
                                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#dcfce7;font-size:12px;font-weight:700;color:#14532d;">
                                        {{ $role }}
                                    </span>
                                </td>
                            </tr>
                        </table>

                        @if ($note !== null)
                            <p style="margin:0 0 24px;padding:14px 16px;background:#f2fcf4;border-radius:14px;font-size:15px;line-height:22px;font-style:italic;color:#1f2937;">
                                {{ $note }}
                            </p>
                        @endif

                        {{-- The one thing to do: the page's big pill. --}}
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                            <tr>
                                <td align="center" style="border-radius:999px;background:#158043;">
                                    <a href="{{ $acceptUrl }}" style="display:block;padding:16px 24px;border-radius:999px;font-family:{!! $body !!};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;text-align:center;">
                                        {{ __('invitation.member.action', [], $locale) }}
                                    </a>
                                </td>
                            </tr>
                        </table>

                        <p style="margin:0 0 4px;font-size:13px;line-height:20px;color:#5b6673;">
                            {{ __('invitation.member.fallback', [], $locale) }}
                        </p>
                        <p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;">
                            <a href="{{ $acceptUrl }}" style="color:#146a3a;text-decoration:underline;">{{ $acceptUrl }}</a>
                        </p>

                        <p style="margin:0 0 12px;padding-top:20px;border-top:1px solid #e8f8ee;font-size:13px;line-height:20px;color:#5b6673;">
                            {{ __('invitation.member.expiry', [], $locale) }}
                        </p>

                        <p style="margin:0;font-size:13px;line-height:20px;color:#5b6673;">
                            {{ __('invitation.member.signoff', [], $locale) }}
                        </p>

                    </td>
                </tr>
            </table>

            <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#5b6673;">
                {{ config('app.name') }}
            </p>

        </td>
    </tr>
</table>
</body>
</html>
