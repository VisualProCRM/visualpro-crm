-- VisualPro CRM WindowcadEvents table: captured raw JSON payloads from WindowCAD7's own
-- CRM webhook (Settings > CRM > API url in WindowCAD7 itself), for discovery purposes while
-- we work out what ICAAL's undocumented integration actually sends. Single DataJson blob
-- per tenant holding an array of recent events, same generic-blob pattern as Orders/Settings.
--
-- Additive only - does not touch Customers/Jobs/Settings.

IF OBJECT_ID('dbo.WindowcadEvents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.WindowcadEvents (
        TenantId    INT             NOT NULL PRIMARY KEY DEFAULT 1,
        DataJson    NVARCHAR(MAX)   NOT NULL,
        UpdatedAt   DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
