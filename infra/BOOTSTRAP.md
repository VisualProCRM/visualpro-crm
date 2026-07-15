# One-time bootstrap (do this once, in the Azure Portal)

Before `deploy-infra.yml` can run, GitHub Actions needs an identity with permission to
deploy into `visualpro-crm_group`, and the SQL server needs an AAD admin. This can't be
created by the Bicep itself (chicken-and-egg), so it's a manual step. About 10-15 minutes.

## 1. Create the deploy identity

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**
   - Name: `gh-deploy-visualpro-crm`
   - Supported account types: *Accounts in this organizational directory only*
   - Redirect URI: leave blank → **Register**
2. On the app's **Overview** page, copy:
   - **Application (client) ID** → this is `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → this is `AZURE_TENANT_ID`
3. Left menu → **Certificates & secrets** → **Federated credentials** tab → **Add credential**
   - Scenario: *GitHub Actions deploying Azure resources*
   - Organization: `VisualProCRM`
   - Repository: `visualpro-crm`
   - Entity type: `Branch` → Branch name: `main`
   - Name: `main-branch-deploy` → **Add**
4. Grant it access to the resource group: go to the `visualpro-crm_group` resource group →
   **Access control (IAM)** → **Add role assignment**
   - Role: `Contributor`
   - Members: search for `gh-deploy-visualpro-crm` → select → **Review + assign**
5. Get its **object ID** (different from the Application ID above — needed for the Key
   Vault access policy): **Microsoft Entra ID** → **Enterprise applications** → search
   `gh-deploy-visualpro-crm` → **Overview** → copy **Object ID** → this is
   `AZURE_DEPLOY_PRINCIPAL_OBJECT_ID`
6. Get your subscription ID: search **Subscriptions** in the Portal → copy the
   **Subscription ID** for the subscription containing `visualpro-crm_group` → this is
   `AZURE_SUBSCRIPTION_ID`

## 2. Create the SQL AAD admin group

Using a group (rather than your individual account) means the deploy identity can also be
added to it, so both you and the pipeline can administer the database.

1. **Microsoft Entra ID** → **Groups** → **New group**
   - Group type: `Security`
   - Group name: `VisualPro CRM SQL Admins`
   - Members: add your own account (`enquiries@visualglazing.co.uk`) **and**
     `gh-deploy-visualpro-crm` → **Create**
2. Open the new group → **Overview** → copy its **Object Id** → this is
   `SQL_AAD_ADMIN_OBJECT_ID`. The display name (`VisualPro CRM SQL Admins`) is
   `SQL_AAD_ADMIN_LOGIN`, and `SQL_AAD_ADMIN_TYPE` is `Group`.

## 3. Create the staff sign-in app registration (used in a later phase, capture now)

1. **Microsoft Entra ID** → **App registrations** → **New registration**
   - Name: `visualpro-crm-auth`
   - Redirect URI: `Web` →
     `https://mango-beach-0c25f86107.azurestaticapps.net/.auth/login/aad/callback`
   - **Register**
2. **Certificates & secrets** → **New client secret** → copy the **Value** immediately (it's
   only shown once) → this is `AAD_CLIENT_SECRET`.
3. Note its **Application (client) ID** somewhere safe — not needed as a GitHub secret yet,
   but you'll need it when we wire up Static Web Apps auth in a later phase.

## 4. Add GitHub repo configuration

Repo → **Settings** → **Secrets and variables** → **Actions**.

**Variables** tab — add each of these:

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | from step 1.2 |
| `AZURE_TENANT_ID` | from step 1.2 |
| `AZURE_SUBSCRIPTION_ID` | from step 1.6 |
| `AZURE_DEPLOY_PRINCIPAL_OBJECT_ID` | from step 1.5 |
| `SQL_AAD_ADMIN_LOGIN` | `VisualPro CRM SQL Admins` |
| `SQL_AAD_ADMIN_OBJECT_ID` | from step 2.2 |
| `SQL_AAD_ADMIN_TYPE` | `Group` |

**Secrets** tab — add:

| Name | Value |
|---|---|
| `AAD_CLIENT_SECRET` | from step 3.2 |

## 5. Run it

Push these `infra/` changes to `main` (or run **Actions → Deploy VisualPro CRM Backend
Infrastructure → Run workflow** manually). Watch the Actions tab — it should provision the
SQL server/database, storage account, Function App, and Key Vault into
`visualpro-crm_group`, then grant the Function App database access automatically.

If the final "Grant Function App managed identity access to SQL database" step fails (it's
the least-tested part of this pipeline — AAD auth flags for `sqlcmd` in CI can be finicky),
you can run the grant manually instead: open the `visualpro-crm-db` database in the Azure
Portal → **Query editor (preview)** → **Continue as <your account>**, then paste the
contents of `infra/scripts/grant-sql-access.sql` with `$(FunctionAppName)` replaced by
`visualpro-crm-func`.
