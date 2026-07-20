// The DB's authoritative columns (Id, Name/Title, Stage/Status, CustomerId, CreatedAt) always
// win over whatever might be sitting in the DataJson blob, so the two can never disagree.

function mapCustomerRow(row) {
  const data = JSON.parse(row.DataJson);
  return { ...data, id: row.Id, name: row.Name, stage: row.Stage, createdAt: row.CreatedAt };
}

function mapJobRow(row) {
  const data = JSON.parse(row.DataJson);
  return {
    ...data,
    id: row.Id,
    customerId: row.CustomerId,
    title: row.Title,
    status: row.Status,
    createdAt: row.CreatedAt,
  };
}

module.exports = { mapCustomerRow, mapJobRow };
