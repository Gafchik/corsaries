<?php

namespace App\Services;

class TelegramInitDataValidator
{
    /** Reject initData older than this many seconds. */
    private const MAX_AGE_SECONDS = 86400;

    /**
     * Validate a raw Telegram WebApp initData string and return its parsed
     * fields (including the decoded `user` object) if valid, or null if the
     * signature is invalid, missing, or the data is stale.
     */
    public function validate(string $initData, string $botToken): ?array
    {
        if ($botToken === '') {
            return null;
        }

        parse_str($initData, $fields);

        $hash = $fields['hash'] ?? null;
        if (! is_string($hash) || $hash === '') {
            return null;
        }
        unset($fields['hash']);

        $pairs = [];
        foreach ($fields as $key => $value) {
            $pairs[] = "{$key}={$value}";
        }
        sort($pairs);
        $dataCheckString = implode("\n", $pairs);

        $secretKey = hash_hmac('sha256', $botToken, 'WebAppData', true);
        $computedHash = hash_hmac('sha256', $dataCheckString, $secretKey);

        if (! hash_equals($computedHash, $hash)) {
            return null;
        }

        $authDate = (int) ($fields['auth_date'] ?? 0);
        if ($authDate <= 0 || (time() - $authDate) > self::MAX_AGE_SECONDS) {
            return null;
        }

        if (isset($fields['user'])) {
            $fields['user'] = json_decode($fields['user'], true);
        }

        return $fields;
    }
}
