<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
        'webhook_url' => env('SLACK_WEBHOOK_URL'),
    ],

    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('GITHUB_REDIRECT_URI'),
        'allowed_emails' => array_filter(array_map('trim', explode(',', env('ALLOWED_EMAILS', '')))),
    ],

    'n8n' => [
        'api_url' => env('N8N_API_URL'),
        'api_key' => env('N8N_API_KEY'),
        'workflow_id' => env('N8N_WORKFLOW_ID'),
        'webhook_secret' => env('N8N_WEBHOOK_SECRET'),
    ],

    'google_sheets' => [
        'service_account_email' => env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
        'private_key' => env('GOOGLE_PRIVATE_KEY'),
        'sheet_id' => env('GOOGLE_SHEET_ID'),
    ],

];
