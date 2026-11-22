import { sql } from 'drizzle-orm'

// Idempotent DDL statements shared by migrate.ts and server startup self-healing.
export const dynamicTablesDDL = [
  `CREATE TABLE IF NOT EXISTS dynamic_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'table',
    color TEXT NOT NULL DEFAULT '#0284c7',
    description TEXT,
    origin TEXT NOT NULL DEFAULT 'manual',
    canvas_x INTEGER NOT NULL DEFAULT 80,
    canvas_y INTEGER NOT NULL DEFAULT 80,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, slug)
  )`,
  `ALTER TABLE dynamic_tables
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual'`,
  `CREATE INDEX IF NOT EXISTS dynamic_tables_clinic_sort_idx
    ON dynamic_tables (clinic_id, sort_order, created_at)`,

  `CREATE TABLE IF NOT EXISTS dynamic_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text',
    is_primary_title BOOLEAN NOT NULL DEFAULT false,
    is_required BOOLEAN NOT NULL DEFAULT false,
    is_unique BOOLEAN NOT NULL DEFAULT false,
    show_in_table BOOLEAN NOT NULL DEFAULT true,
    width INTEGER NOT NULL DEFAULT 180,
    sort_order INTEGER NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (table_id, slug)
  )`,
  `CREATE INDEX IF NOT EXISTS dynamic_columns_table_sort_idx
    ON dynamic_columns (table_id, sort_order, created_at)`,

  `CREATE TABLE IF NOT EXISTS dynamic_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    source_table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    source_column_id UUID NOT NULL REFERENCES dynamic_columns(id) ON DELETE CASCADE,
    target_table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    inverse_column_id UUID REFERENCES dynamic_columns(id) ON DELETE SET NULL,
    cardinality TEXT NOT NULL DEFAULT 'one_to_many',
    on_delete TEXT NOT NULL DEFAULT 'set_null',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dynamic_relations_clinic_idx
    ON dynamic_relations (clinic_id, source_table_id, target_table_id)`,

  `CREATE TABLE IF NOT EXISTS dynamic_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    display_title TEXT NOT NULL DEFAULT '',
    values JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dynamic_rows_table_active_idx
    ON dynamic_rows (clinic_id, table_id, is_archived, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dynamic_rows_values_gin_idx
    ON dynamic_rows USING GIN (values)`,

  `CREATE TABLE IF NOT EXISTS dynamic_row_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    relation_id UUID NOT NULL REFERENCES dynamic_relations(id) ON DELETE CASCADE,
    source_row_id UUID NOT NULL REFERENCES dynamic_rows(id) ON DELETE CASCADE,
    target_row_id UUID NOT NULL REFERENCES dynamic_rows(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (relation_id, source_row_id, target_row_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dynamic_row_links_source_idx
    ON dynamic_row_links (clinic_id, source_row_id)`,
  `CREATE INDEX IF NOT EXISTS dynamic_row_links_target_idx
    ON dynamic_row_links (clinic_id, target_row_id)`,

  `CREATE TABLE IF NOT EXISTS dynamic_appointment_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    title_column_id UUID REFERENCES dynamic_columns(id) ON DELETE SET NULL,
    phone_column_id UUID REFERENCES dynamic_columns(id) ON DELETE SET NULL,
    email_column_id UUID REFERENCES dynamic_columns(id) ON DELETE SET NULL,
    is_required_in_appointment BOOLEAN NOT NULL DEFAULT false,
    allow_multiple BOOLEAN NOT NULL DEFAULT false,
    include_related_tables BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, table_id)
  )`,
  `ALTER TABLE dynamic_appointment_configs
    ADD COLUMN IF NOT EXISTS allow_multiple BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE dynamic_appointment_configs
    ADD COLUMN IF NOT EXISTS include_related_tables BOOLEAN NOT NULL DEFAULT true`,
  `CREATE INDEX IF NOT EXISTS dynamic_appointment_configs_clinic_idx
    ON dynamic_appointment_configs (clinic_id, enabled)`,

  `CREATE TABLE IF NOT EXISTS dynamic_appointment_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL REFERENCES dental_appointments(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    row_id UUID NOT NULL REFERENCES dynamic_rows(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (appointment_id, row_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dynamic_appointment_links_appt_idx
    ON dynamic_appointment_links (clinic_id, appointment_id)`,
  `CREATE INDEX IF NOT EXISTS dynamic_appointment_links_row_idx
    ON dynamic_appointment_links (clinic_id, row_id)`,

  `CREATE TABLE IF NOT EXISTS dynamic_module_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    module_role TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, table_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dynamic_module_configs_clinic_role_idx
    ON dynamic_module_configs (clinic_id, module_role, enabled)`,

  // Pre-accounting integration foundation (Paraşüt, Logo İşbaşı, Bizim Hesap, KolayBi', Mikro, Uyumsoft, Dia, Custom Webhook)
  `CREATE TABLE IF NOT EXISTS finance_accounting_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    sync_mode TEXT NOT NULL DEFAULT 'manual',
    external_company_id TEXT,
    credentials_encrypted TEXT,
    account_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, provider)
  )`,
  `CREATE INDEX IF NOT EXISTS finance_accounting_connections_clinic_status_idx
    ON finance_accounting_connections (clinic_id, status)`,

  `CREATE TABLE IF NOT EXISTS finance_accounting_sync_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    row_id UUID NOT NULL REFERENCES dynamic_rows(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES dynamic_tables(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'local',
    idempotency_key TEXT NOT NULL,
    external_document_id TEXT,
    external_contact_id TEXT,
    external_payment_id TEXT,
    external_document_number TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    payload_hash TEXT,
    canonical_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (clinic_id, row_id, provider)
  )`,
  `CREATE INDEX IF NOT EXISTS finance_accounting_sync_clinic_status_idx
    ON finance_accounting_sync_records (clinic_id, sync_status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS finance_accounting_sync_external_idx
    ON finance_accounting_sync_records (clinic_id, provider, external_document_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS finance_accounting_sync_idempotency_idx
    ON finance_accounting_sync_records (clinic_id, provider, idempotency_key)`,
]

let dynamicSchemaPromise: Promise<void> | undefined

export function ensureDynamicTablesSchema(): Promise<void> {
  if (!dynamicSchemaPromise) {
    dynamicSchemaPromise = (async () => {
      const { db } = await import('./client')
      for (const statement of dynamicTablesDDL) {
        await db.execute(sql.raw(statement))
      }
    })().catch((error) => {
      dynamicSchemaPromise = undefined
      throw error
    })
  }
  return dynamicSchemaPromise
}

