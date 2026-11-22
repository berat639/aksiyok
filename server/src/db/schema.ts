import { pgTable, uuid, text, boolean, integer, bigint, timestamp, date, primaryKey, jsonb, uniqueIndex, index, bigserial } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  accountId: uuid('account_id'),
  startedAt: timestamp('started_at', { withTimezone: true }).default(sql`now()`),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  totalTokens: bigint('total_tokens', { mode: 'number' }).default(0),
  status: text('status').default('active'),
})

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  sessionId: text('session_id'),
  calendarEventId: text('calendar_event_id'),
  data: jsonb('data').notNull().default({}),
  // Legacy columns kept for backward-compatible appointment reads.
  customerName: text('customer_name').notNull().default(''),
  phone: text('phone').notNull().default(''),
  type: text('type').notNull().default(''),
  vehicleInfo: text('vehicle_info'),
  issueOrRequest: text('issue_or_request'),
  date: text('date').notNull().default(''),
  time: text('time').notNull().default(''),
  discountRequested: boolean('discount_requested').default(false),
  notes: text('notes'),
  extraFields: text('extra_fields'),
})

export const conversationFlows = pgTable('conversation_flows', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  name: text('name').notNull().default('main'),
  direction: text('direction').notNull().default('inbound'),
  nodes: jsonb('nodes').notNull().default([]),
  edges: jsonb('edges').notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).default(sql`now()`),
})

/** Durable checkpoints only; PCM and transcript chunks are intentionally never stored here. */
export const flowSessions = pgTable('flow_sessions', {
  id: uuid('id').primaryKey(),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  direction: text('direction').notNull(),
  channel: text('channel').notNull(),
  flowId: uuid('flow_id').references(() => conversationFlows.id),
  status: text('status').notNull().default('active'),
  revision: integer('revision').notNull().default(0),
  state: jsonb('state').notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('flow_sessions_expiry_idx').on(t.expiresAt)])

// ── Dental Clinic: Patients, Calendar ────────────────────────────────────────

export const clinics = pgTable('clinics', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  businessTemplate: text('business_template').notNull().default('general'),
  netgsmUsercode: text('netgsm_usercode'),
  netgsmPassword: text('netgsm_password'),
  smsSenderId: text('sms_sender_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // Evolution API; secrets use AES-256-GCM.
  evolutionBaseUrl: text('evolution_base_url'),
  evolutionApiKey: text('evolution_api_key'),
  evolutionInstanceName: text('evolution_instance_name'),
  evolutionWebhookSecret: text('evolution_webhook_secret'),
  evolutionConnectionState: text('evolution_connection_state').notNull().default('unconfigured'),
  whatsappSetupStatus: text('whatsapp_setup_status').notNull().default('not_started'),
  whatsappExpectedPhone: text('whatsapp_expected_phone'),
  whatsappLinkedPhone: text('whatsapp_linked_phone'),
  whatsappNumberVerifiedAt: timestamp('whatsapp_number_verified_at', { withTimezone: true }),
  whatsappTestPhone: text('whatsapp_test_phone'),
  whatsappTestCodeHash: text('whatsapp_test_code_hash'),
  whatsappTestExpiresAt: timestamp('whatsapp_test_expires_at', { withTimezone: true }),
  whatsappTestVerifiedAt: timestamp('whatsapp_test_verified_at', { withTimezone: true }),
  whatsappActivatedAt: timestamp('whatsapp_activated_at', { withTimezone: true }),
  whatsappActivatedBy: uuid('whatsapp_activated_by').references(() => users.id),
  whatsappAiEnabled: boolean('whatsapp_ai_enabled').notNull().default(false),
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(false),
  // n8n + Meta WhatsApp Cloud API bridge (coexists with Evolution)
  whatsappProvider: text('whatsapp_provider').notNull().default('evolution'),
  n8nInboundSecret: text('n8n_inbound_secret'),
  n8nSendWebhookUrl: text('n8n_send_webhook_url'),
  metaPhoneNumberId: text('meta_phone_number_id'),
  metaWabaId: text('meta_waba_id'),
  metaAccessToken: text('meta_access_token'),
  metaVerifyToken: text('meta_verify_token'),
  whatsappTemplates: jsonb('whatsapp_templates').notNull().default([]),
  // Per-clinic Gemini API key (AES-256-GCM encrypted via integration-secrets)
  geminiApiKey: text('gemini_api_key'),
  geminiKeyLast4: text('gemini_key_last4'),
  geminiKeyUpdatedAt: timestamp('gemini_key_updated_at', { withTimezone: true }),
  geminiKeyUpdatedBy: uuid('gemini_key_updated_by').references(() => users.id),
  // Subscription & SaaS Plan Entitlements
  planId: text('plan_id').notNull().default('kurumsal'),
  planStatus: text('plan_status').notNull().default('active'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  maxUsers: integer('max_users').notNull().default(999),
  iyzicoSubscriptionRef: text('iyzico_subscription_ref'),
  iyzicoCustomerRef: text('iyzico_customer_ref'),
})

export const clinicAiUsageDaily = pgTable('clinic_ai_usage_daily', {
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  source: text('source').notNull().default('live_phone'),
  promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
  responseTokens: bigint('response_tokens', { mode: 'number' }).notNull().default(0),
  totalTokens: bigint('total_tokens', { mode: 'number' }).notNull().default(0),
  callCount: integer('call_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.clinicId, t.day, t.source] }),
  index('clinic_ai_usage_daily_clinic_day_idx').on(t.clinicId, t.day),
])

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const clinicDomains = pgTable('clinic_domains', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull().unique(),
  isPrimary: boolean('is_primary').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [index('clinic_domains_clinic_idx').on(t.clinicId)])

export const clinicPhoneNumbers = pgTable('clinic_phone_numbers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  phoneNumber: text('phone_number').notNull(),
  label: text('label'),
  isActive: boolean('is_active').notNull().default(true),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('clinic_phone_numbers_phone_unique').on(t.phoneNumber),
  index('clinic_phone_numbers_clinic_idx').on(t.clinicId),
])

export const clinicSettings = pgTable('clinic_settings', {
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [primaryKey({ columns: [t.clinicId, t.key] })])

export const notificationTemplates = pgTable('notification_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  type: text('type').notNull(), // 'sms', 'email', 'whatsapp'
  name: text('name').notNull(), // e.g. 'periodic_reminder'
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const whatsappConversations = pgTable('whatsapp_conversations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  patientPhone: text('patient_phone'), // E.164; null for unresolved LID senders
  instanceName: text('instance_name'),
  remoteJid: text('remote_jid'),
  aiPaused: boolean('ai_paused').notNull().default(false),
  patientId: uuid('patient_id').references(() => patients.id),
  // Conversation history stored as JSON array of {role, text} for Gemini chat
  history: jsonb('history').notNull().default([]),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  senderPushName: text('sender_push_name'),
  activeDynamicContext: jsonb('active_dynamic_context').$type<{
    rowIds: string[]
    matchedUrl: string | null
    tableName?: string | null
    updatedAt: string
  } | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('wa_conversation_identity').on(t.clinicId, t.instanceName, t.remoteJid)])

export const whatsappContacts = pgTable('whatsapp_contacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  phoneLast10: text('phone_last10').notNull(),
  remoteJid: text('remote_jid'),
  contactName: text('contact_name').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('wa_contacts_clinic_phone10_idx').on(t.clinicId, t.phoneLast10),
  index('wa_contacts_clinic_jid_idx').on(t.clinicId, t.remoteJid),
])

export const whatsappMessages = pgTable('whatsapp_messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sequence: bigserial('sequence', { mode: 'number' }).notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id),
  externalId: text('external_id').notNull(),
  direction: text('direction').notNull(),
  text: text('text').notNull(),
  status: text('status').notNull().default('pending'),
  replyText: text('reply_text'),
  providerMessageId: text('provider_message_id'),
  deliveryStatus: text('delivery_status'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('wa_message_external').on(t.conversationId, t.externalId),
  index('wa_message_pending').on(t.status, t.availableAt),
])

export const whatsappToolExecutions = pgTable('whatsapp_tool_executions', {
  messageId: uuid('message_id').notNull().references(() => whatsappMessages.id),
  name: text('name').notNull(),
  arguments: jsonb('arguments').notNull(),
  result: jsonb('result').notNull(),
}, (t) => [primaryKey({ columns: [t.messageId, t.name] })])

export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  tcIdentity: text('tc_identity'),
  gender: text('gender'),
  birthDate: timestamp('birth_date', { withTimezone: true }),
  birthYear: integer('birth_year'),
  balance: integer('balance').notNull().default(0),
  whatsappOptOut: boolean('whatsapp_opt_out').notNull().default(false), // Hasta WA bildirimlerini kapattı mı?
  smsOptOut: boolean('sms_opt_out').notNull().default(false), // Hasta SMS bildirimlerini kapattı mı?
  emailOptOut: boolean('email_opt_out').notNull().default(false), // Hasta Email bildirimlerini kapattı mı?
  isArchived: boolean('is_archived').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const dentalAppointments = pgTable('dental_appointments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  // AI talepleri desk tarafından doğrulanana kadar gerçek bir hastaya bağlı değildir.
  patientId: uuid('patient_id').references(() => patients.id),
  doctorId: uuid('doctor_id').references(() => users.id),
  title: text('title').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('scheduled'),
  type: text('type').notNull().default('general'),
  complaint: text('complaint'),
  notes: text('notes'),
  timeConfirmed: boolean('time_confirmed').notNull().default(true),
  intakeSource: text('intake_source'),
  intakePatientName: text('intake_patient_name'),
  intakePatientPhone: text('intake_patient_phone'),
  reviewStatus: text('review_status'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  patientResponseStatus: text('patient_response_status'),
  patientResponseNote: text('patient_response_note'),
  patientPreferredDate: text('patient_preferred_date'),
  patientRespondedAt: timestamp('patient_responded_at', { withTimezone: true }),
  patientResponseChannel: text('patient_response_channel'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // Kept explicitly because the patient sidebar is ordered by the latest
  // appointment operation, not the appointment's scheduled time.
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const doctorLeaves = pgTable('doctor_leaves', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  substituteDoctorId: uuid('substitute_doctor_id').references(() => users.id),
  date: text('date').notNull(), // 'YYYY-MM-DD'
  startTime: text('start_time').notNull(), // 'HH:mm'
  endTime: text('end_time').notNull(), // 'HH:mm'
  isFullDay: boolean('is_full_day').notNull().default(false),
  reason: text('reason'), // 'Yıllık İzin', 'Mazeret', 'Seminer' vb.
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const treatmentGroups = pgTable('treatment_groups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'), // active, completed, cancelled
  createdById: uuid('created_by_id').references(() => users.id),
  updatedById: uuid('updated_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const treatmentPlans = pgTable('treatment_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  doctorId: uuid('doctor_id').references(() => users.id),
  groupId: uuid('group_id').references(() => treatmentGroups.id),
  procedureName: text('procedure_name').notNull(),
  toothNumber: text('tooth_number'),
  indication: text('indication'),
  cost: integer('cost').notNull().default(0),
  status: text('status').notNull().default('planned'),
  dcmUrl: text('dcm_url'),
  
  // Periodic Notifications
  isPeriodic: boolean('is_periodic').notNull().default(false),
  periodDays: integer('period_days'),
  nextNotificationDate: text('next_notification_date'), // YYYY-MM-DD
  notifyPatient: boolean('notify_patient').notNull().default(false),
  notificationType: text('notification_type').default('sms'), // sms, email, both
  notificationSentAt: timestamp('notification_sent_at', { withTimezone: true }),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// Extra planning data is kept separately so older containers can continue to
// read the original treatment tables during a rolling deployment.
export const treatmentGroupDetails = pgTable('treatment_group_details', {
  groupId: uuid('group_id').primaryKey().references(() => treatmentGroups.id),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  version: integer('version').notNull().default(1),
  idempotencyKey: text('idempotency_key'),
  requestHash: text('request_hash'),
  consultationNote: text('consultation_note').notNull().default(''),
  discountPercentBps: integer('discount_percent_bps').notNull().default(0),
  discountFixedMinor: bigint('discount_fixed_minor', { mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
}, (t) => [uniqueIndex('treatment_group_details_request_idx').on(t.clinicId, t.idempotencyKey)])

export const treatmentPlanDetails = pgTable('treatment_plan_details', {
  treatmentId: uuid('treatment_id').primaryKey().references(() => treatmentPlans.id),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  basePriceMinor: bigint('base_price_minor', { mode: 'number' }).notNull().default(0),
  netPriceMinor: bigint('net_price_minor', { mode: 'number' }).notNull().default(0),
  materials: jsonb('materials').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  stockState: text('stock_state').notNull().default('planned'),
})

export const treatmentCatalog = pgTable('treatment_catalog', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  scope: text('scope').notNull().default('tooth'),
  priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
  color: text('color').notNull().default('#0284c7'),
  materials: jsonb('materials').notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('treatment_catalog_active_name_idx').on(t.clinicId, t.kind, t.nameKey).where(sql`${t.active} = true`)])

export const patientConsentRequests = pgTable('patient_consent_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  patientId: uuid('patient_id').references(() => patients.id),
  dynamicRowId: uuid('dynamic_row_id'),
  recipientName: text('recipient_name'),
  recipientPhone: text('recipient_phone'),
  deliveryChannel: text('delivery_channel').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  requestKey: text('request_key').notNull(),
  status: text('status').notNull().default('pending'),
  textVersion: text('text_version').notNull(),
  textSnapshot: text('text_snapshot').notNull(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
}, (t) => [uniqueIndex('patient_consent_request_key_idx').on(t.clinicId, t.requestKey)])

export const patientConsentPreferences = pgTable('patient_consent_preferences', {
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  channel: text('channel').notNull(),
  status: text('status').notNull(),
  textVersion: text('text_version').notNull(),
  requestId: uuid('request_id').notNull().references(() => patientConsentRequests.id),
  respondedAt: timestamp('responded_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.clinicId, t.patientId, t.channel] })])

export const contactChannelPreferences = pgTable('contact_channel_preferences', {
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  phoneLast10: text('phone_last10').notNull(),
  channel: text('channel').notNull(),
  status: text('status').notNull(),
  textVersion: text('text_version').notNull(),
  requestId: uuid('request_id').references(() => patientConsentRequests.id, { onDelete: 'set null' }),
  dynamicRowId: uuid('dynamic_row_id'),
  respondedAt: timestamp('responded_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.clinicId, t.phoneLast10, t.channel] })])

export const planAttachments = pgTable('plan_attachments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  groupId: uuid('group_id').references(() => treatmentGroups.id),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  requestKey: text('request_key').notNull(),
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('plan_attachment_request_idx').on(t.clinicId, t.requestKey)])

export const planAttachmentFiles = pgTable('plan_attachment_files', {
  attachmentId: uuid('attachment_id').notNull().references(() => planAttachments.id),
  fileIndex: integer('file_index').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploadedBytes: bigint('uploaded_bytes', { mode: 'number' }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.attachmentId, t.fileIndex] })])

// Junction table: links appointments to treatment plan items (many-to-many)
// One treatment can be done across multiple appointments (sessions), one appointment can include many treatments
export const appointmentTreatments = pgTable('appointment_treatments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  appointmentId: uuid('appointment_id').notNull().references(() => dentalAppointments.id, { onDelete: 'cascade' }),
  treatmentPlanId: uuid('treatment_plan_id').notNull().references(() => treatmentPlans.id, { onDelete: 'cascade' }),
  sessionNumber: integer('session_number').notNull().default(1), // For multi-session treatments (e.g., Canal 1st, 2nd session)
  sessionStatus: text('session_status').notNull().default('planned'), // planned | done | skipped
  notes: text('notes'), // Session-specific notes
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const patientPayments = pgTable('patient_payments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  treatmentPlanId: uuid('treatment_plan_id').references(() => treatmentPlans.id),
  date: text('date').notNull(),
  amount: integer('amount').notNull(),
  method: text('method').notNull().default('Nakit'),
  notes: text('notes'),
  status: text('status').notNull().default('completed'),
  isActive: boolean('is_active').notNull().default(true),
  dueDate: text('due_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// Financial documents are intentionally kept separate from collections. A payment
// is not an invoice, and a draft here is never presented as a legally-issued
// e-Invoice/e-Archive document until an authorised integrator confirms it.
export const clinicFinanceSettings = pgTable('clinic_finance_settings', {
  clinicId: uuid('clinic_id').primaryKey().references(() => clinics.id, { onDelete: 'cascade' }),
  legalName: text('legal_name'),
  taxNumber: text('tax_number'),
  taxOffice: text('tax_office'),
  mersisNumber: text('mersis_number'),
  address: text('address'),
  email: text('email'),
  invoicePrefix: text('invoice_prefix').notNull().default('FTR'),
  eDocumentProvider: text('e_document_provider').notNull().default('none'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// Credentials are encrypted at rest by the finance API. Provider adapters can
// consume this table without changing the clinic's core payment records.
export const onlinePaymentProviders = pgTable('online_payment_providers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  merchantId: text('merchant_id'),
  apiKeyEncrypted: text('api_key_encrypted'),
  secretEncrypted: text('secret_encrypted'),
  webhookSecretEncrypted: text('webhook_secret_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  clinicProvider: uniqueIndex('online_payment_providers_clinic_provider_idx').on(table.clinicId, table.provider),
}))

export const completedWorks = pgTable('completed_works', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  doctorId: uuid('doctor_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// Single-doc + multi-chunk model (admin UI uses category/title/content/active)
export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  category: text('category').notNull().default('genel'),
  title: text('title').notNull(),
  content: text('content').notNull(),
  active: boolean('active').notNull().default(true),
  callDirection: text('call_direction').notNull().default('both'),
  embeddingModel: text('embedding_model'),
  embeddingDims: integer('embedding_dims'),
  contentHash: text('content_hash'),
  // embedding vector(768) is managed via raw SQL — pgvector type not in drizzle-orm/pg-core
  embeddedAt: timestamp('embedded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const knowledgeDocChunks = pgTable('knowledge_doc_chunks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull().default(0),
  content: text('content').notNull().default(''),
  callDirection: text('call_direction').notNull().default('both'),
  // embedding vector(768) is managed via raw SQL
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('knowledge_doc_chunks_doc_idx').on(t.documentId, t.chunkIndex),
  index('knowledge_doc_chunks_clinic_idx').on(t.clinicId),
])

export const knowledgeCategories = pgTable('knowledge_categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  icon: text('icon').notNull().default('📁'),
  color: text('color').notNull().default('#60a5fa'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('knowledge_categories_clinic_slug_unique').on(t.clinicId, t.slug)])

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect
export type NewKnowledgeDocument = typeof knowledgeDocuments.$inferInsert

export type Session = typeof sessions.$inferSelect
export type Appointment = typeof appointments.$inferSelect
export type NewAppointment = typeof appointments.$inferInsert

export type KnowledgeCategory = typeof knowledgeCategories.$inferSelect

// ── RBAC: Users, Sessions, Shifts, Notifications, Audit ─────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  avatar: text('avatar'),
  role: text('role').notNull().default('calisan'),
  specialty: text('specialty'),
  color: text('color'),
  active: boolean('active').notNull().default(true),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  googleSub: text('google_sub'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('users_google_sub_uniq').on(t.googleSub).where(sql`${t.googleSub} IS NOT NULL`),
])

export const clinicMemberships = pgTable('clinic_memberships', {
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('calisan'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.clinicId, t.userId] }),
  index('clinic_memberships_user_idx').on(t.userId),
])

export const staffInvitations = pgTable('staff_invitations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('calisan'),
  specialty: text('specialty'),
  color: text('color'),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending | accepted | revoked | expired
  kvkkTextVersion: text('kvkk_text_version').notNull(),
  kvkkTextSnapshot: text('kvkk_text_snapshot').notNull(),
  kvkkAcceptedAt: timestamp('kvkk_accepted_at', { withTimezone: true }),
  invitedBy: uuid('invited_by').references(() => users.id),
  acceptedUserId: uuid('accepted_user_id').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
}, (t) => [
  index('staff_invitations_clinic_status_idx').on(t.clinicId, t.status),
  index('staff_invitations_email_idx').on(t.clinicId, t.email),
])

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenJti: text('token_jti').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const shifts = pgTable('shifts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  date: text('date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  shiftType: text('shift_type').notNull().default('tam'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const shiftPlanOperations = pgTable('shift_plan_operations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const shiftPlanOperationItems = pgTable('shift_plan_operation_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  operationId: uuid('operation_id').notNull().references(() => shiftPlanOperations.id, { onDelete: 'cascade' }),
  shiftId: uuid('shift_id').references(() => shifts.id),
  action: text('action').notNull(),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state').notNull(),
})

export const shiftSwapRequests = pgTable('shift_swap_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  targetId: uuid('target_id').notNull().references(() => users.id),
  shiftId: uuid('shift_id').notNull().references(() => shifts.id),
  targetShiftId: uuid('target_shift_id').references(() => shifts.id),
  status: text('status').notNull().default('pending'),
  reason: text('reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
})

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  metadata: jsonb('metadata').default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  category: text('category').notNull().default('malzeme'),
  itemName: text('item_name').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitCost: integer('unit_cost').notNull().default(0),
  totalCost: integer('total_cost').notNull().default(0),
  enteredBy: uuid('entered_by').references(() => users.id),
  notes: text('notes'),
  date: text('date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  name: text('name').notNull(),
  category: text('category').notNull().default('genel'),
  brand: text('brand'),
  quantity: integer('quantity').notNull().default(0),
  minThreshold: integer('min_threshold').notNull().default(5),
  unit: text('unit').notNull().default('adet'),
  costPerUnit: integer('cost_per_unit').notNull().default(0),
  expiryDate: text('expiry_date'),
  supplierName: text('supplier_name'),
  lastRestockedAt: timestamp('last_restocked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const deviceMaintenances = pgTable('device_maintenances', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  deviceName: text('device_name').notNull(),
  maintenanceType: text('maintenance_type').notNull(),
  isPeriodic: boolean('is_periodic').notNull().default(false),
  periodicDays: integer('periodic_days'),
  scheduledDate: text('scheduled_date').notNull(),
  nextMaintenanceDate: text('next_maintenance_date'),
  completedDate: text('completed_date'),
  serialNumber: text('serial_number'),
  maintenanceFirm: text('maintenance_firm'),
  warrantyEnd: text('warranty_end'),
  deviceStatus: text('device_status').notNull().default('active'),
  notes: text('notes'),
  status: text('status').notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  itemId: uuid('item_id').notNull().references(() => inventoryItems.id),
  type: text('type').notNull(),
  quantity: integer('quantity').notNull(),
  notes: text('notes'),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const waitingList = pgTable('waiting_list', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  preferredDoctorId: uuid('preferred_doctor_id').references(() => users.id),
  preferredDate: text('preferred_date'),
  preferredTimeRange: text('preferred_time_range'),
  notes: text('notes'),
  status: text('status').notNull().default('waiting'),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const toothRecords = pgTable('tooth_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  toothNumber: integer('tooth_number').notNull(),
  surface: text('surface'),
  condition: text('condition').notNull().default('healthy'),
  treatmentId: uuid('treatment_id').references(() => treatmentPlans.id),
  notes: text('notes'),
  recordedBy: uuid('recorded_by').references(() => users.id),
  date: text('date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const consultations = pgTable('consultations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  doctorId: uuid('doctor_id').references(() => users.id),
  consultationNote: text('consultation_note').notNull(),
  diseaseNote: text('disease_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const doctorNotes = pgTable('doctor_notes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  doctorId: uuid('doctor_id').notNull().references(() => users.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const patientAnamnesis = pgTable('patient_anamnesis', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  formData: jsonb('form_data').notNull().default({}),
  filledBy: uuid('filled_by').references(() => users.id),
  filledAt: timestamp('filled_at', { withTimezone: true }).defaultNow(),
})

export const patientDiseases = pgTable('patient_diseases', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  name: text('name').notNull(),
  notes: text('notes'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const materialUsages = pgTable('material_usages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  doctorId: uuid('doctor_id').notNull().references(() => users.id),
  patientId: uuid('patient_id').references(() => patients.id),
  appointmentId: uuid('appointment_id').references(() => dentalAppointments.id),
  inventoryItemId: uuid('inventory_item_id').notNull().references(() => inventoryItems.id),
  quantity: integer('quantity').notNull().default(1),
  date: text('date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const installmentPlans = pgTable('installment_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  totalAmount: integer('total_amount').notNull(),
  installmentCount: integer('installment_count').notNull(),
  paidCount: integer('paid_count').notNull().default(0),
  installments: jsonb('installments').notNull().default([]),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const patientNotes = pgTable('patient_notes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  patientId: uuid('patient_id').references(() => patients.id),
  phone: text('phone'),
  content: text('content').notNull(),
  source: text('source').notNull().default('voice'),
  status: text('status').notNull().default('unread'),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`),
})

export const vipAssistants = pgTable('vip_assistants', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id),
  phone: text('phone').notNull(),
  contactName: text('contact_name'),
  greeting: text('greeting').notNull().default('Merhaba! Ben kişisel asistanınız Pine Asistan, hoş geldiniz! Nasıl yardımcı olabilirim?'),
  customPrompt: text('custom_prompt'),
  groundingEnabled: boolean('grounding_enabled').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [uniqueIndex('vip_assistants_clinic_phone_unique').on(t.clinicId, t.phone)])

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Shift = typeof shifts.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type NewKnowledgeCategory = typeof knowledgeCategories.$inferInsert
export type PatientDisease = typeof patientDiseases.$inferSelect
export type NewPatientDisease = typeof patientDiseases.$inferInsert
export type PatientNote = typeof patientNotes.$inferSelect
export type NewPatientNote = typeof patientNotes.$inferInsert
export type VipAssistant = typeof vipAssistants.$inferSelect
export type NewVipAssistant = typeof vipAssistants.$inferInsert
export type DoctorLeave = typeof doctorLeaves.$inferSelect
export type NewDoctorLeave = typeof doctorLeaves.$inferInsert

// ── Dynamic Tables & Relations Studio ────────────────────────────────────────

export const dynamicTables = pgTable('dynamic_tables', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  icon: text('icon').notNull().default('table'),
  color: text('color').notNull().default('#0284c7'),
  description: text('description'),
  origin: text('origin').notNull().default('manual'),
  canvasX: integer('canvas_x').notNull().default(80),
  canvasY: integer('canvas_y').notNull().default(80),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dynamic_tables_clinic_slug_unique').on(t.clinicId, t.slug),
  index('dynamic_tables_clinic_sort_idx').on(t.clinicId, t.sortOrder, t.createdAt),
])

export const dynamicColumns = pgTable('dynamic_columns', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  fieldType: text('field_type').notNull().default('text'),
  isPrimaryTitle: boolean('is_primary_title').notNull().default(false),
  isRequired: boolean('is_required').notNull().default(false),
  isUnique: boolean('is_unique').notNull().default(false),
  showInTable: boolean('show_in_table').notNull().default(true),
  width: integer('width').notNull().default(180),
  sortOrder: integer('sort_order').notNull().default(0),
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dynamic_columns_table_slug_unique').on(t.tableId, t.slug),
  index('dynamic_columns_table_sort_idx').on(t.tableId, t.sortOrder, t.createdAt),
])

export const dynamicRelations = pgTable('dynamic_relations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  sourceTableId: uuid('source_table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  sourceColumnId: uuid('source_column_id').notNull().references(() => dynamicColumns.id, { onDelete: 'cascade' }),
  targetTableId: uuid('target_table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  inverseColumnId: uuid('inverse_column_id').references(() => dynamicColumns.id, { onDelete: 'set null' }),
  cardinality: text('cardinality').notNull().default('one_to_many'),
  onDelete: text('on_delete').notNull().default('set_null'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('dynamic_relations_clinic_idx').on(t.clinicId, t.sourceTableId, t.targetTableId),
])

export const dynamicRows = pgTable('dynamic_rows', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  displayTitle: text('display_title').notNull().default(''),
  values: jsonb('values').notNull().default({}),
  isArchived: boolean('is_archived').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('dynamic_rows_table_active_idx').on(t.clinicId, t.tableId, t.isArchived, t.createdAt),
])

export const dynamicRowLinks = pgTable('dynamic_row_links', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  relationId: uuid('relation_id').notNull().references(() => dynamicRelations.id, { onDelete: 'cascade' }),
  sourceRowId: uuid('source_row_id').notNull().references(() => dynamicRows.id, { onDelete: 'cascade' }),
  targetRowId: uuid('target_row_id').notNull().references(() => dynamicRows.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dynamic_row_links_unique').on(t.relationId, t.sourceRowId, t.targetRowId),
  index('dynamic_row_links_source_idx').on(t.clinicId, t.sourceRowId),
  index('dynamic_row_links_target_idx').on(t.clinicId, t.targetRowId),
])

export const dynamicAppointmentConfigs = pgTable('dynamic_appointment_configs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  titleColumnId: uuid('title_column_id').references(() => dynamicColumns.id, { onDelete: 'set null' }),
  phoneColumnId: uuid('phone_column_id').references(() => dynamicColumns.id, { onDelete: 'set null' }),
  emailColumnId: uuid('email_column_id').references(() => dynamicColumns.id, { onDelete: 'set null' }),
  isRequiredInAppointment: boolean('is_required_in_appointment').notNull().default(false),
  allowMultiple: boolean('allow_multiple').notNull().default(false),
  includeRelatedTables: boolean('include_related_tables').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dynamic_appointment_configs_clinic_table_unique').on(t.clinicId, t.tableId),
  index('dynamic_appointment_configs_clinic_idx').on(t.clinicId, t.enabled),
])

export const dynamicAppointmentLinks = pgTable('dynamic_appointment_links', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  appointmentId: uuid('appointment_id').notNull().references(() => dentalAppointments.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  rowId: uuid('row_id').notNull().references(() => dynamicRows.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dynamic_appointment_links_appt_row_unique').on(t.appointmentId, t.rowId),
  index('dynamic_appointment_links_appt_idx').on(t.clinicId, t.appointmentId),
  index('dynamic_appointment_links_row_idx').on(t.clinicId, t.rowId),
])

export const dynamicModuleConfigs = pgTable('dynamic_module_configs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  moduleRole: text('module_role').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  mapping: jsonb('mapping').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('dynamic_module_configs_clinic_table_unique').on(t.clinicId, t.tableId),
  index('dynamic_module_configs_clinic_role_idx').on(t.clinicId, t.moduleRole, t.enabled),
])

export const financeAccountingConnections = pgTable('finance_accounting_connections', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('disconnected'),
  syncMode: text('sync_mode').notNull().default('manual'),
  externalCompanyId: text('external_company_id'),
  credentialsEncrypted: text('credentials_encrypted'),
  accountMapping: jsonb('account_mapping').notNull().default({}),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('finance_accounting_connections_clinic_provider_unique').on(t.clinicId, t.provider),
  index('finance_accounting_connections_clinic_status_idx').on(t.clinicId, t.status),
])

export const financeAccountingSyncRecords = pgTable('finance_accounting_sync_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  rowId: uuid('row_id').notNull().references(() => dynamicRows.id, { onDelete: 'cascade' }),
  tableId: uuid('table_id').notNull().references(() => dynamicTables.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(),
  provider: text('provider').notNull().default('local'),
  idempotencyKey: text('idempotency_key').notNull(),
  externalDocumentId: text('external_document_id'),
  externalContactId: text('external_contact_id'),
  externalPaymentId: text('external_payment_id'),
  externalDocumentNumber: text('external_document_number'),
  syncStatus: text('sync_status').notNull().default('pending'),
  payloadHash: text('payload_hash'),
  canonicalSnapshot: jsonb('canonical_snapshot').notNull().default({}),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('finance_accounting_sync_clinic_row_provider_unique').on(t.clinicId, t.rowId, t.provider),
  index('finance_accounting_sync_clinic_status_idx').on(t.clinicId, t.syncStatus, t.updatedAt),
  index('finance_accounting_sync_external_idx').on(t.clinicId, t.provider, t.externalDocumentId),
  uniqueIndex('finance_accounting_sync_idempotency_idx').on(t.clinicId, t.provider, t.idempotencyKey),
])

export type DynamicTable = typeof dynamicTables.$inferSelect
export type DynamicColumn = typeof dynamicColumns.$inferSelect
export type DynamicRelation = typeof dynamicRelations.$inferSelect
export type DynamicRow = typeof dynamicRows.$inferSelect
export type DynamicAppointmentConfig = typeof dynamicAppointmentConfigs.$inferSelect
export type DynamicModuleConfig = typeof dynamicModuleConfigs.$inferSelect
export type FinanceAccountingConnection = typeof financeAccountingConnections.$inferSelect
export type FinanceAccountingSyncRecord = typeof financeAccountingSyncRecords.$inferSelect

export const flowAiMessages = pgTable('flow_ai_messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull().default('inbound'),
  role: text('role').notNull(),
  content: text('content').notNull(),
  appliedFlow: boolean('applied_flow').notNull().default(false),
  nodeCount: integer('node_count'),
  edgeCount: integer('edge_count'),
  changeSummary: text('change_summary'),
  previousFlow: jsonb('previous_flow'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('flow_ai_messages_clinic_dir_created_idx').on(t.clinicId, t.direction, t.createdAt),
])

export type FlowAiMessage = typeof flowAiMessages.$inferSelect

// ── Public Onboarding, OAuth, Subscriptions & Billing ────────────────────────

export const authOtpChallenges = pgTable('auth_otp_challenges', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  target: text('target').notNull(),
  channel: text('channel').notNull(),
  purpose: text('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  payload: jsonb('payload'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('auth_otp_challenges_target_purpose_idx').on(t.target, t.purpose, t.createdAt),
])

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  mode: text('mode').notNull(),
  planId: text('plan_id'),
  redirectAfter: text('redirect_after'),
  codeVerifier: text('code_verifier'),
  ipAddress: text('ip_address'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const upgradeRequests = pgTable('upgrade_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').references(() => clinics.id, { onDelete: 'cascade' }),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  requestType: text('request_type').notNull(),
  requestedPlan: text('requested_plan').notNull().default('pro'),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  companyName: text('company_name'),
  notes: text('notes'),
  status: text('status').notNull().default('pending'),
  handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('upgrade_requests_status_created_idx').on(t.status, t.createdAt),
  index('upgrade_requests_clinic_created_idx').on(t.clinicId, t.createdAt),
])

export const subscriptionPayments = pgTable('subscription_payments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id').notNull().references(() => clinics.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  planId: text('plan_id').notNull(),
  provider: text('provider').notNull().default('iyzico'),
  conversationId: text('conversation_id').notNull().unique(),
  token: text('token'),
  paymentId: text('payment_id'),
  amountNet: integer('amount_net').notNull(),
  vatRate: integer('vat_rate').notNull().default(20),
  amountGross: integer('amount_gross').notNull(),
  currency: text('currency').notNull().default('TRY'),
  status: text('status').notNull().default('initiated'),
  consentsSnapshot: jsonb('consents_snapshot').notNull().default({}),
  rawEvent: jsonb('raw_event'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('subscription_payments_clinic_created_idx').on(t.clinicId, t.createdAt),
])

export type AuthOtpChallenge = typeof authOtpChallenges.$inferSelect
export type OAuthStateRow = typeof oauthStates.$inferSelect
export type UpgradeRequestRow = typeof upgradeRequests.$inferSelect
export type SubscriptionPaymentRow = typeof subscriptionPayments.$inferSelect
