// Maps SQL rows (PascalCase columns, TabsJson/ProductsJson as strings) to the shape the
// frontend already expects, matching seedCustomers/seedJobs in index.html.

function mapCustomerRow(row) {
  return {
    id: row.Id,
    name: row.Name,
    email: row.Email,
    phone: row.Phone,
    address: row.Address,
    source: row.Source,
    stage: row.Stage,
    notes: row.Notes,
    createdAt: row.CreatedAt,
    windowcad: row.WindowCad,
    quoteValue: row.QuoteValue,
    quoteCost: row.QuoteCost,
    tabs: row.TabsJson ? JSON.parse(row.TabsJson) : {},
  };
}

function mapJobRow(row) {
  return {
    id: row.Id,
    customerId: row.CustomerId,
    title: row.Title,
    products: row.ProductsJson ? JSON.parse(row.ProductsJson) : [],
    status: row.Status,
    surveyDate: row.SurveyDate,
    installDate: row.InstallDate,
    installers: row.Installers,
    windowcad: row.WindowCad,
    value: row.Value,
    notes: row.Notes,
    tabs: row.TabsJson ? JSON.parse(row.TabsJson) : {},
  };
}

module.exports = { mapCustomerRow, mapJobRow };
