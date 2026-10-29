-- 011_create_subscriptions_and_billing.sql
-- NomaanOS Sentinel: Subscriptions, Billing Records, and Razorpay Integration

-- 1. Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(32) NOT NULL CHECK (target_type IN ('workspace', 'organization')),
    target_id UUID NOT NULL,
    plan_id VARCHAR(32) NOT NULL DEFAULT 'free',
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'paused')),
    billing_cycle VARCHAR(32) NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
    provider VARCHAR(32) NOT NULL DEFAULT 'razorpay',
    provider_customer_id VARCHAR(255) NULL,
    provider_subscription_id VARCHAR(255) NULL,
    provider_plan_id VARCHAR(255) NULL,
    current_period_start TIMESTAMPTZ NULL,
    current_period_end TIMESTAMPTZ NULL,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMPTZ NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subscription_target UNIQUE (target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_target ON subscriptions (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub ON subscriptions (provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

-- 2. Create billing_webhook_events table for idempotent event processing
CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(32) NOT NULL DEFAULT 'razorpay',
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processing_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_webhooks_event_id ON billing_webhook_events (event_id);
CREATE INDEX IF NOT EXISTS idx_billing_webhooks_processed ON billing_webhook_events (processed);

-- 3. Create billing_payments table to record invoice and checkout transactions
CREATE TABLE IF NOT EXISTS billing_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    provider_payment_id VARCHAR(255) NULL,
    provider_order_id VARCHAR(255) NULL,
    provider_invoice_id VARCHAR(255) NULL,
    amount_paise BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(32) NOT NULL CHECK (status IN ('created', 'authorized', 'captured', 'refunded', 'failed')),
    error_code VARCHAR(255) NULL,
    error_description TEXT NULL,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_sub ON billing_payments (subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_payment_id ON billing_payments (provider_payment_id);

