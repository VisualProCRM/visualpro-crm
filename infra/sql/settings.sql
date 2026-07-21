-- VisualPro CRM Settings table: a single row per tenant holding the whole Settings object
-- (fitters, staff, suppliers, company details, email templates, feedback questions, fitter
-- passwords) as one DataJson blob, same generic-blob approach as Customers/Jobs and for the
-- same reason - no per-field schema to keep in sync as Settings grows.
--
-- Additive only - does not touch Customers/Jobs, which now hold real production data.

IF OBJECT_ID('dbo.Settings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Settings (
        TenantId    INT             NOT NULL PRIMARY KEY DEFAULT 1,
        DataJson    NVARCHAR(MAX)   NOT NULL,
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
