-- VisualPro CRM Orders table: the manually-added entries on the "Track Orders" calendar
-- page (separate from the deliveries embedded in a Job's installation tab, which already
-- round-trip via dbo.Jobs) as a single DataJson blob per tenant, same generic-blob pattern
-- as Settings.
--
-- Additive only - does not touch Customers/Jobs/Settings.

IF OBJECT_ID('dbo.Orders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Orders (
        TenantId    INT             NOT NULL PRIMARY KEY DEFAULT 1,
        DataJson    NVARCHAR(MAX)   NOT NULL,
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
