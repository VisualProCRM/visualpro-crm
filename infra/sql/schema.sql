-- VisualPro CRM core schema: Customers (sales pipeline) and Jobs (installation pipeline).
-- Deep per-record data (quotes, surveys, order confirmations, bills, guarantees, tasks, service
-- calls) is kept in TabsJson for now, matching the app's existing `tabs` object shape 1:1, so no
-- data is lost while the relational model for those sub-entities is built out in a later phase.
-- Idempotent: safe to re-run. No GO batch separators — this is pasted directly into the Azure
-- Portal Query Editor, which doesn't understand GO (a client-tool convention, not real T-SQL).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Customers')
BEGIN
    CREATE TABLE dbo.Customers (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        Name          NVARCHAR(200)   NOT NULL,
        Email         NVARCHAR(200)   NULL,
        Phone         NVARCHAR(50)    NULL,
        Address       NVARCHAR(500)   NULL,
        Source        NVARCHAR(100)   NULL,
        Stage         NVARCHAR(100)   NOT NULL DEFAULT 'New Enquiry',
        Notes         NVARCHAR(MAX)   NULL,
        WindowCad     NVARCHAR(100)   NULL,
        QuoteValue    DECIMAL(10,2)   NULL,
        QuoteCost     DECIMAL(10,2)   NULL,
        TabsJson      NVARCHAR(MAX)   NULL,
        CreatedAt     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Customers_Stage')
BEGIN
    CREATE INDEX IX_Customers_Stage ON dbo.Customers(Stage);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Jobs')
BEGIN
    CREATE TABLE dbo.Jobs (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        CustomerId    INT             NOT NULL,
        Title         NVARCHAR(300)   NOT NULL,
        ProductsJson  NVARCHAR(MAX)   NULL,
        Status        NVARCHAR(100)   NOT NULL DEFAULT 'Book Survey',
        SurveyDate    DATE            NULL,
        InstallDate   DATE            NULL,
        Installers    NVARCHAR(300)   NULL,
        WindowCad     NVARCHAR(100)   NULL,
        Value         DECIMAL(10,2)   NULL,
        Notes         NVARCHAR(MAX)   NULL,
        TabsJson      NVARCHAR(MAX)   NULL,
        CreatedAt     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Jobs_Customers FOREIGN KEY (CustomerId) REFERENCES dbo.Customers(Id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Jobs_CustomerId')
BEGIN
    CREATE INDEX IX_Jobs_CustomerId ON dbo.Jobs(CustomerId);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Jobs_Status')
BEGIN
    CREATE INDEX IX_Jobs_Status ON dbo.Jobs(Status);
END
