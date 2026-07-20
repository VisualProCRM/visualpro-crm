-- VisualPro CRM core schema: Customers (sales pipeline) and Jobs (installation pipeline).
--
-- Design: only a few fields that need server-side filtering (Stage/Status, CustomerId) are
-- real columns. Everything else about a customer/job (name, email, quote, tabs, sold-by,
-- products of interest, and any other field the frontend already has) is stored as-is in
-- DataJson, the full record exactly as sent by the app. This avoids the alternative of
-- listing every field as its own column, which risks silently dropping data for any field
-- not anticipated up front — a real risk given how large and organically-grown this app is.
--
-- TenantId is included now (defaulted to 1, "VisualPro" itself) as cheap insurance against a
-- painful migration later, in case this ever gets sold to other businesses as multi-tenant SaaS.
-- No actual multi-tenancy is built yet — every row today belongs to tenant 1.
--
-- Idempotent-ish: drops and recreates both tables. Safe right now because no real customer
-- data has been entered yet — do NOT re-run this against a database with real records.

IF OBJECT_ID('dbo.Jobs', 'U') IS NOT NULL DROP TABLE dbo.Jobs;
IF OBJECT_ID('dbo.Customers', 'U') IS NOT NULL DROP TABLE dbo.Customers;

CREATE TABLE dbo.Customers (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    TenantId    INT             NOT NULL DEFAULT 1,
    Name        NVARCHAR(200)   NOT NULL,
    Stage       NVARCHAR(100)   NOT NULL DEFAULT 'New Enquiry',
    DataJson    NVARCHAR(MAX)   NOT NULL,
    CreatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_Customers_TenantId ON dbo.Customers(TenantId);
CREATE INDEX IX_Customers_Stage ON dbo.Customers(Stage);

CREATE TABLE dbo.Jobs (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    TenantId    INT             NOT NULL DEFAULT 1,
    CustomerId  INT             NOT NULL,
    Title       NVARCHAR(300)   NOT NULL,
    Status      NVARCHAR(100)   NOT NULL DEFAULT 'Book Survey',
    DataJson    NVARCHAR(MAX)   NOT NULL,
    CreatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Jobs_Customers FOREIGN KEY (CustomerId) REFERENCES dbo.Customers(Id)
);

CREATE INDEX IX_Jobs_TenantId ON dbo.Jobs(TenantId);
CREATE INDEX IX_Jobs_CustomerId ON dbo.Jobs(CustomerId);
CREATE INDEX IX_Jobs_Status ON dbo.Jobs(Status);
