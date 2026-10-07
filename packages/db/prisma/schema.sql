-- =====================================================================
--  Siow System — esquema do banco (PostgreSQL / Neon)
--  Gerado a partir de packages/db/prisma/schema.prisma (Prisma 6, provider postgresql).
--  Equivale ao que `prisma db push` criaria. Todo comando é idempotente
--  (IF NOT EXISTS / verificação em pg_constraint): pode ser executado mais de uma vez.
--
--  Como usar (Neon → SQL Editor): cole o arquivo inteiro e clique em Run.
--  Depois, inicialize dados com POST /api/admin/bootstrap (ver docs/DEPLOY-VERCEL.md).
--
--  Observações:
--   - ids (uuid) são gerados pela aplicação (Prisma), por isso não há DEFAULT nas colunas "id".
--   - colunas "updatedAt" são preenchidas pela aplicação (@updatedAt), sem DEFAULT.
--   - Se alterar schema.prisma, atualize este arquivo (ou rode `pnpm --filter @siow/web db:push`).
-- =====================================================================

-- ---------------------------------------------------------------------
--  Tipos enumerados
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "EntityType" AS ENUM ('PM', 'CM', 'AUTARQUIA', 'FUNDO', 'INSTITUTO', 'CONSORCIO', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DataSourceProvider" AS ENUM ('ASSESI_PORTAL', 'ASSESI_API', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'BULK', 'RETRY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RecordOrigin" AS ENUM ('SYNC', 'MANUAL', 'IMPORT', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AmendmentKind" AS ENUM ('TERM', 'VALUE', 'OBJECT', 'MIXED', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'FIELD_CHANGED', 'MISSING_FROM_SOURCE', 'REAPPEARED', 'MANUAL_OVERRIDE', 'RECONCILED', 'CONFLICT_DETECTED', 'CONFLICT_RESOLVED', 'NOTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'KEPT_MANUAL', 'ACCEPTED_SOURCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'SERVICE_REPORT', 'PAYMENT_REQUEST', 'LABOR_DECLARATION', 'RECEIPT', 'AMENDMENT_REQUEST', 'CERTIFICATE', 'CONTRACT', 'SERVICE_ORDER', 'SERVICE_ORDER_SIGNED', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TaskType" AS ENUM ('CHARGE_CLIENT', 'CHARGE_AGAIN', 'VERIFY_PAYMENT', 'REQUEST_SERVICE_ORDER', 'VERIFY_SIGNATURE', 'RENEW_CERTIFICATE', 'VERIFY_CONTRACT', 'SEND_DOCUMENT', 'CONFIRM_PAYMENT', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CollectionStatus" AS ENUM ('NOT_CHARGED', 'SCHEDULED', 'SENT', 'CLIENT_REPLIED', 'PAYMENT_PROMISED', 'AWAITING_PAYMENT', 'SETTLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE', 'IN_PERSON', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OutboundMessageStatus" AS ENUM ('DRAFT', 'MANUAL_PENDING', 'MANUALLY_CONFIRMED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ServiceOrderStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'AWAITING_ISSUE', 'ISSUED', 'AWAITING_SIGNATURE', 'SIGNED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SignatureProvider" AS ENUM ('MANUAL_UPLOAD', 'CLICKSIGN', 'DOCUSIGN', 'GOV_BR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SignatureRequestStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED_MANUALLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('CERTIFICATE_EXPIRING', 'CERTIFICATE_EXPIRED', 'CONTRACT_EXPIRING', 'INVOICE_OVERDUE', 'SYNC_FAILED', 'RECONCILIATION_NEEDED', 'TASK_DUE', 'SERVICE_ORDER_PENDING', 'GENERIC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------
--  Tabelas
-- ---------------------------------------------------------------------

-- User
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3) NULL,
  "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  "twoFactorSecret" TEXT NULL,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- Role
CREATE TABLE IF NOT EXISTS "roles" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- Permission
CREATE TABLE IF NOT EXISTS "permissions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NULL,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- UserRole
CREATE TABLE IF NOT EXISTS "user_roles" (
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId", "roleId")
);

-- RolePermission
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId", "permissionId")
);

-- Session
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3) NULL,
  "replacedById" TEXT NULL,
  "ip" TEXT NULL,
  "userAgent" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- UserPermission
CREATE TABLE IF NOT EXISTS "UserPermission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- Entity
CREATE TABLE IF NOT EXISTS "entities" (
  "id" TEXT NOT NULL,
  "type" "EntityType" NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT NULL,
  "municipality" TEXT NOT NULL,
  "uf" CHAR(2) NOT NULL,
  "cnpj" TEXT NULL,
  "logoUrl" TEXT NULL,
  "notes" TEXT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "responsibleUserId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- DataSource
CREATE TABLE IF NOT EXISTS "data_sources" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "provider" "DataSourceProvider" NOT NULL DEFAULT 'ASSESI_PORTAL',
  "url" TEXT NOT NULL,
  "externalEntityCode" TEXT NULL,
  "externalEntityType" TEXT NULL,
  "label" TEXT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB NULL,
  "lastSyncAt" TIMESTAMP(3) NULL,
  "lastSyncStatus" "SyncStatus" NULL,
  "lastSyncRunId" TEXT NULL,
  "lastSuccessAt" TIMESTAMP(3) NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "circuitOpenUntil" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- SyncRun
CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id" TEXT NOT NULL,
  "dataSourceId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "trigger" "SyncTrigger" NOT NULL,
  "status" "SyncStatus" NOT NULL DEFAULT 'QUEUED',
  "requestedByUserId" TEXT NULL,
  "jobId" TEXT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NULL,
  "finishedAt" TIMESTAMP(3) NULL,
  "durationMs" INTEGER NULL,
  "stats" JSONB NULL,
  "errorMessage" TEXT NULL,
  "errorDetails" TEXT NULL,
  "warnings" JSONB NULL,
  CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- Contract
CREATE TABLE IF NOT EXISTS "contracts" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "externalCode" TEXT NULL,
  "object" TEXT NULL,
  "description" TEXT NULL,
  "monthlyValue" DECIMAL(14,2) NULL,
  "totalValue" DECIMAL(14,2) NULL,
  "startDate" DATE NULL,
  "endDate" DATE NULL,
  "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
  "expectsMonthlyBilling" BOOLEAN NOT NULL DEFAULT true,
  "responsibleUserId" TEXT NULL,
  "origin" "RecordOrigin" NOT NULL DEFAULT 'MANUAL',
  "notes" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- ContractAmendment
CREATE TABLE IF NOT EXISTS "contract_amendments" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "label" TEXT NULL,
  "kind" "AmendmentKind" NOT NULL DEFAULT 'OTHER',
  "description" TEXT NULL,
  "signedAt" DATE NULL,
  "effectiveFrom" DATE NULL,
  "newEndDate" DATE NULL,
  "newMonthlyValue" DECIMAL(14,2) NULL,
  "newObject" TEXT NULL,
  "origin" "RecordOrigin" NOT NULL DEFAULT 'MANUAL',
  "documentId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- Invoice
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "contractId" TEXT NULL,
  "dataSourceId" TEXT NULL,
  "number" TEXT NOT NULL,
  "externalId" TEXT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "issueDate" DATE NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "sourceStatusRaw" TEXT NULL,
  "paidAt" DATE NULL,
  "paidAmount" DECIMAL(14,2) NULL,
  "description" TEXT NULL,
  "documentUrl" TEXT NULL,
  "receiptUrl" TEXT NULL,
  "origin" "RecordOrigin" NOT NULL DEFAULT 'SYNC',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "missingSince" TIMESTAMP(3) NULL,
  "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
  "reconciliationNote" TEXT NULL,
  "manualOverride" BOOLEAN NOT NULL DEFAULT false,
  "overrideJustification" TEXT NULL,
  "overriddenByUserId" TEXT NULL,
  "overriddenAt" TIMESTAMP(3) NULL,
  "rawSnapshot" JSONB NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- InvoiceEvent
CREATE TABLE IF NOT EXISTS "invoice_events" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "type" "InvoiceEventType" NOT NULL,
  "field" TEXT NULL,
  "oldValue" TEXT NULL,
  "newValue" TEXT NULL,
  "origin" "RecordOrigin" NOT NULL,
  "userId" TEXT NULL,
  "syncRunId" TEXT NULL,
  "note" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);

-- SyncConflict
CREATE TABLE IF NOT EXISTS "sync_conflicts" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "syncRunId" TEXT NULL,
  "field" TEXT NOT NULL,
  "manualValue" TEXT NULL,
  "sourceValue" TEXT NULL,
  "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedByUserId" TEXT NULL,
  "resolvedAt" TIMESTAMP(3) NULL,
  "resolutionNote" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- DocumentBlob
CREATE TABLE IF NOT EXISTS "document_blobs" (
  "id" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_blobs_pkey" PRIMARY KEY ("id")
);

-- Document
CREATE TABLE IF NOT EXISTS "documents" (
  "id" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "name" TEXT NOT NULL,
  "blobId" TEXT NOT NULL,
  "entityId" TEXT NULL,
  "contractId" TEXT NULL,
  "invoiceId" TEXT NULL,
  "serviceOrderId" TEXT NULL,
  "originalUrl" TEXT NULL,
  "sourceDate" DATE NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedByUserId" TEXT NULL,
  "origin" "RecordOrigin" NOT NULL DEFAULT 'MANUAL',
  "metadata" JSONB NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- Certificate
CREATE TABLE IF NOT EXISTS "certificates" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "entityId" TEXT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CertificateVersion
CREATE TABLE IF NOT EXISTS "certificate_versions" (
  "id" TEXT NOT NULL,
  "certificateId" TEXT NOT NULL,
  "externalId" TEXT NULL,
  "sourceUrl" TEXT NULL,
  "issuedAt" DATE NULL,
  "validUntil" DATE NULL,
  "documentId" TEXT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "origin" "RecordOrigin" NOT NULL DEFAULT 'SYNC',
  "registeredByUserId" TEXT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "certificate_versions_pkey" PRIMARY KEY ("id")
);

-- Contact
CREATE TABLE IF NOT EXISTS "contacts" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NULL,
  "department" TEXT NULL,
  "phone" TEXT NULL,
  "whatsapp" TEXT NULL,
  "email" TEXT NULL,
  "notes" TEXT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isFinancial" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- FinancialTask
CREATE TABLE IF NOT EXISTS "financial_tasks" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NULL,
  "type" "TaskType" NOT NULL DEFAULT 'CUSTOM',
  "entityId" TEXT NULL,
  "contractId" TEXT NULL,
  "invoiceId" TEXT NULL,
  "serviceOrderId" TEXT NULL,
  "assigneeUserId" TEXT NULL,
  "createdByUserId" TEXT NULL,
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
  "dueDate" DATE NOT NULL,
  "dueTime" TEXT NULL,
  "notes" TEXT NULL,
  "completedAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "financial_tasks_pkey" PRIMARY KEY ("id")
);

-- TaskEvent
CREATE TABLE IF NOT EXISTS "task_events" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NULL,
  "action" TEXT NOT NULL,
  "fromValue" TEXT NULL,
  "toValue" TEXT NULL,
  "note" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CollectionCase
CREATE TABLE IF NOT EXISTS "collection_cases" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "status" "CollectionStatus" NOT NULL DEFAULT 'NOT_CHARGED',
  "assigneeUserId" TEXT NULL,
  "nextActionAt" DATE NULL,
  "nextActionNote" TEXT NULL,
  "promisedPaymentDate" DATE NULL,
  "lastAttemptAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collection_cases_pkey" PRIMARY KEY ("id")
);

-- CollectionAttempt
CREATE TABLE IF NOT EXISTS "collection_attempts" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "performedByUserId" TEXT NULL,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "channel" "MessageChannel" NOT NULL,
  "contactId" TEXT NULL,
  "message" TEXT NULL,
  "response" TEXT NULL,
  "resultingStatus" "CollectionStatus" NOT NULL,
  "nextActionAt" DATE NULL,
  "nextActionNote" TEXT NULL,
  "messageId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collection_attempts_pkey" PRIMARY KEY ("id")
);

-- MessageTemplate
CREATE TABLE IF NOT EXISTS "message_templates" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" "MessageChannel" NULL,
  "subject" TEXT NULL,
  "body" TEXT NOT NULL,
  "variables" JSONB NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- OutboundMessage
CREATE TABLE IF NOT EXISTS "outbound_messages" (
  "id" TEXT NOT NULL,
  "channel" "MessageChannel" NOT NULL,
  "templateId" TEXT NULL,
  "entityId" TEXT NULL,
  "contactId" TEXT NULL,
  "invoiceId" TEXT NULL,
  "serviceOrderId" TEXT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NULL,
  "body" TEXT NOT NULL,
  "status" "OutboundMessageStatus" NOT NULL DEFAULT 'DRAFT',
  "providerName" TEXT NULL,
  "providerMessageId" TEXT NULL,
  "providerResponse" JSONB NULL,
  "errorMessage" TEXT NULL,
  "sentByUserId" TEXT NULL,
  "sentAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- ServiceOrder
CREATE TABLE IF NOT EXISTS "service_orders" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "invoiceId" TEXT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "number" TEXT NULL,
  "status" "ServiceOrderStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "requestedAt" DATE NULL,
  "issuedAt" DATE NULL,
  "signedAt" DATE NULL,
  "documentId" TEXT NULL,
  "signedDocumentId" TEXT NULL,
  "notes" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NULL,
  CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- ServiceOrderSignatory
CREATE TABLE IF NOT EXISTS "service_order_signatories" (
  "id" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NULL,
  "email" TEXT NULL,
  "signedAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_order_signatories_pkey" PRIMARY KEY ("id")
);

-- ServiceOrderEvent
CREATE TABLE IF NOT EXISTS "service_order_events" (
  "id" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "userId" TEXT NULL,
  "action" TEXT NOT NULL,
  "fromValue" TEXT NULL,
  "toValue" TEXT NULL,
  "note" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_order_events_pkey" PRIMARY KEY ("id")
);

-- SignatureRequest
CREATE TABLE IF NOT EXISTS "signature_requests" (
  "id" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "provider" "SignatureProvider" NOT NULL,
  "providerRequestId" TEXT NULL,
  "status" "SignatureRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt" TIMESTAMP(3) NULL,
  "completedAt" TIMESTAMP(3) NULL,
  "signedDocumentId" TEXT NULL,
  "evidence" JSONB NULL,
  "registeredByUserId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- AuditLog
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NULL,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "resourceId" TEXT NULL,
  "before" JSONB NULL,
  "after" JSONB NULL,
  "justification" TEXT NULL,
  "ip" TEXT NULL,
  "userAgent" TEXT NULL,
  "requestId" TEXT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Notification
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NULL,
  "entityId" TEXT NULL,
  "referenceType" TEXT NULL,
  "referenceId" TEXT NULL,
  "dedupeKey" TEXT NULL,
  "readAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Setting
CREATE TABLE IF NOT EXISTS "settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "description" TEXT NULL,
  "updatedByUserId" TEXT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);


-- ---------------------------------------------------------------------
--  Índices (únicos e de consulta)
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_key" ON "permissions"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserPermission_userId_permissionId_key" ON "UserPermission"("userId", "permissionId");
CREATE UNIQUE INDEX IF NOT EXISTS "entities_type_municipality_uf_key" ON "entities"("type", "municipality", "uf");
CREATE INDEX IF NOT EXISTS "entities_municipality_idx" ON "entities"("municipality");
CREATE INDEX IF NOT EXISTS "entities_uf_idx" ON "entities"("uf");
CREATE UNIQUE INDEX IF NOT EXISTS "data_sources_provider_url_key" ON "data_sources"("provider", "url");
CREATE INDEX IF NOT EXISTS "data_sources_entityId_idx" ON "data_sources"("entityId");
CREATE INDEX IF NOT EXISTS "sync_runs_dataSourceId_queuedAt_idx" ON "sync_runs"("dataSourceId", "queuedAt");
CREATE INDEX IF NOT EXISTS "sync_runs_entityId_queuedAt_idx" ON "sync_runs"("entityId", "queuedAt");
CREATE INDEX IF NOT EXISTS "sync_runs_status_idx" ON "sync_runs"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_entityId_number_key" ON "contracts"("entityId", "number");
CREATE INDEX IF NOT EXISTS "contracts_entityId_idx" ON "contracts"("entityId");
CREATE INDEX IF NOT EXISTS "contracts_endDate_idx" ON "contracts"("endDate");
CREATE UNIQUE INDEX IF NOT EXISTS "contract_amendments_contractId_sequence_key" ON "contract_amendments"("contractId", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_entityId_number_key" ON "invoices"("entityId", "number");
CREATE INDEX IF NOT EXISTS "invoices_entityId_status_idx" ON "invoices"("entityId", "status");
CREATE INDEX IF NOT EXISTS "invoices_contractId_competenceYear_competenceMonth_idx" ON "invoices"("contractId", "competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "invoices_status_issueDate_idx" ON "invoices"("status", "issueDate");
CREATE INDEX IF NOT EXISTS "invoices_paidAt_idx" ON "invoices"("paidAt");
CREATE INDEX IF NOT EXISTS "invoice_events_invoiceId_createdAt_idx" ON "invoice_events"("invoiceId", "createdAt");
CREATE INDEX IF NOT EXISTS "sync_conflicts_status_idx" ON "sync_conflicts"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "document_blobs_checksum_key" ON "document_blobs"("checksum");
CREATE UNIQUE INDEX IF NOT EXISTS "document_blobs_storageKey_key" ON "document_blobs"("storageKey");
CREATE INDEX IF NOT EXISTS "documents_entityId_type_idx" ON "documents"("entityId", "type");
CREATE INDEX IF NOT EXISTS "documents_invoiceId_idx" ON "documents"("invoiceId");
CREATE INDEX IF NOT EXISTS "documents_contractId_idx" ON "documents"("contractId");
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_slug_entityId_key" ON "certificates"("slug", "entityId");
CREATE INDEX IF NOT EXISTS "certificate_versions_certificateId_isCurrent_idx" ON "certificate_versions"("certificateId", "isCurrent");
CREATE INDEX IF NOT EXISTS "certificate_versions_validUntil_idx" ON "certificate_versions"("validUntil");
CREATE INDEX IF NOT EXISTS "contacts_entityId_idx" ON "contacts"("entityId");
CREATE INDEX IF NOT EXISTS "financial_tasks_assigneeUserId_status_dueDate_idx" ON "financial_tasks"("assigneeUserId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "financial_tasks_entityId_dueDate_idx" ON "financial_tasks"("entityId", "dueDate");
CREATE INDEX IF NOT EXISTS "financial_tasks_dueDate_idx" ON "financial_tasks"("dueDate");
CREATE INDEX IF NOT EXISTS "task_events_taskId_createdAt_idx" ON "task_events"("taskId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_cases_invoiceId_key" ON "collection_cases"("invoiceId");
CREATE INDEX IF NOT EXISTS "collection_cases_entityId_status_idx" ON "collection_cases"("entityId", "status");
CREATE INDEX IF NOT EXISTS "collection_cases_nextActionAt_idx" ON "collection_cases"("nextActionAt");
CREATE UNIQUE INDEX IF NOT EXISTS "collection_attempts_messageId_key" ON "collection_attempts"("messageId");
CREATE INDEX IF NOT EXISTS "collection_attempts_caseId_performedAt_idx" ON "collection_attempts"("caseId", "performedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_key_key" ON "message_templates"("key");
CREATE INDEX IF NOT EXISTS "outbound_messages_entityId_createdAt_idx" ON "outbound_messages"("entityId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "service_orders_contractId_competenceYear_competenceMonth_key" ON "service_orders"("contractId", "competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "service_orders_entityId_status_idx" ON "service_orders"("entityId", "status");
CREATE INDEX IF NOT EXISTS "service_order_events_serviceOrderId_createdAt_idx" ON "service_order_events"("serviceOrderId", "createdAt");
CREATE INDEX IF NOT EXISTS "signature_requests_serviceOrderId_idx" ON "signature_requests"("serviceOrderId");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_resourceId_idx" ON "audit_logs"("resource", "resourceId");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupeKey_key" ON "notifications"("dedupeKey");
CREATE INDEX IF NOT EXISTS "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- ---------------------------------------------------------------------
--  Chaves estrangeiras
-- ---------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_userId_fkey') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_roleId_fkey') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_roleId_fkey') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permissionId_fkey') THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_userId_fkey') THEN
    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPermission_userId_fkey') THEN
    ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPermission_permissionId_fkey') THEN
    ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_responsibleUserId_fkey') THEN
    ALTER TABLE "entities" ADD CONSTRAINT "entities_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'data_sources_entityId_fkey') THEN
    ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_runs_dataSourceId_fkey') THEN
    ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_runs_entityId_fkey') THEN
    ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_runs_requestedByUserId_fkey') THEN
    ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_entityId_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_responsibleUserId_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_contractId_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_documentId_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_entityId_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_contractId_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_dataSourceId_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_overriddenByUserId_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_overriddenByUserId_fkey" FOREIGN KEY ("overriddenByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_events_invoiceId_fkey') THEN
    ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_events_userId_fkey') THEN
    ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_events_syncRunId_fkey') THEN
    ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_conflicts_invoiceId_fkey') THEN
    ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_conflicts_syncRunId_fkey') THEN
    ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_conflicts_resolvedByUserId_fkey') THEN
    ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_blobId_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "document_blobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_entityId_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_contractId_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_invoiceId_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_serviceOrderId_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_uploadedByUserId_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificates_entityId_fkey') THEN
    ALTER TABLE "certificates" ADD CONSTRAINT "certificates_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_versions_certificateId_fkey') THEN
    ALTER TABLE "certificate_versions" ADD CONSTRAINT "certificate_versions_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_versions_documentId_fkey') THEN
    ALTER TABLE "certificate_versions" ADD CONSTRAINT "certificate_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificate_versions_registeredByUserId_fkey') THEN
    ALTER TABLE "certificate_versions" ADD CONSTRAINT "certificate_versions_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_entityId_fkey') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_tasks_entityId_fkey') THEN
    ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_tasks_contractId_fkey') THEN
    ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_tasks_invoiceId_fkey') THEN
    ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_tasks_serviceOrderId_fkey') THEN
    ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_tasks_assigneeUserId_fkey') THEN
    ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_tasks_createdByUserId_fkey') THEN
    ALTER TABLE "financial_tasks" ADD CONSTRAINT "financial_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_events_taskId_fkey') THEN
    ALTER TABLE "task_events" ADD CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "financial_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_events_userId_fkey') THEN
    ALTER TABLE "task_events" ADD CONSTRAINT "task_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_cases_invoiceId_fkey') THEN
    ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_cases_entityId_fkey') THEN
    ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_cases_assigneeUserId_fkey') THEN
    ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_attempts_caseId_fkey') THEN
    ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "collection_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_attempts_performedByUserId_fkey') THEN
    ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_attempts_contactId_fkey') THEN
    ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_attempts_messageId_fkey') THEN
    ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "outbound_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_templateId_fkey') THEN
    ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_entityId_fkey') THEN
    ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_contactId_fkey') THEN
    ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_invoiceId_fkey') THEN
    ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_serviceOrderId_fkey') THEN
    ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbound_messages_sentByUserId_fkey') THEN
    ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_entityId_fkey') THEN
    ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_contractId_fkey') THEN
    ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_invoiceId_fkey') THEN
    ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_documentId_fkey') THEN
    ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_signedDocumentId_fkey') THEN
    ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_signatories_serviceOrderId_fkey') THEN
    ALTER TABLE "service_order_signatories" ADD CONSTRAINT "service_order_signatories_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_events_serviceOrderId_fkey') THEN
    ALTER TABLE "service_order_events" ADD CONSTRAINT "service_order_events_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_events_userId_fkey') THEN
    ALTER TABLE "service_order_events" ADD CONSTRAINT "service_order_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_serviceOrderId_fkey') THEN
    ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_signedDocumentId_fkey') THEN
    ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_registeredByUserId_fkey') THEN
    ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_userId_fkey') THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_userId_fkey') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_entityId_fkey') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_updatedByUserId_fkey') THEN
    ALTER TABLE "settings" ADD CONSTRAINT "settings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------
--  Auditoria append-only: bloqueia UPDATE/DELETE/TRUNCATE em audit_logs
--  (mesmo SQL usado pelo seed / POST /api/admin/bootstrap)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (operation % blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- Fim. Próximo passo: POST /api/admin/bootstrap (cria permissões, papéis, admin, modelos e configurações).

