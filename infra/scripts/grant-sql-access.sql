-- Run once after each infra deploy (idempotent) against the visualpro-crm-db database,
-- authenticated as a principal with rights to create users (the SQL AAD admin group).
-- Invoked by the deploy-infra workflow via sqlcmd with -v FunctionAppName=<name>.
--
-- Grants the Function App's system-assigned managed identity read/write access to the
-- database. No password or connection string is created or stored anywhere for this --
-- the Function App authenticates as itself via its Azure AD identity.

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$(FunctionAppName)')
BEGIN
    CREATE USER [$(FunctionAppName)] FROM EXTERNAL PROVIDER;
END

ALTER ROLE db_datareader ADD MEMBER [$(FunctionAppName)];
ALTER ROLE db_datawriter ADD MEMBER [$(FunctionAppName)];
