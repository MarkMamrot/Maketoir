/**
 * Updates the Monsterthreads DB spreadsheet with confirmed Cin7 Omni API facts:
 *   - APIInstructions!  → corrected instructions text + endpoints JSON (column D)
 *   - Schema_cin7!      → full rewrite with verified endpoints and fields only
 *
 * Confirmed via live endpoint probing on 2026-04-30:
 *   EXISTS (200/401):  /Products /Contacts /SalesOrders /PurchaseOrders /Stock /Branches
 *   NOT FOUND (404):   /ProductsList /SalesOrderLines /SalesInvoices /PurchaseOrderLines
 *                      /ProductAvailability /StockAdjustments
 */

import 'dotenv/config';
import { google } from 'googleapis';

const credRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8')
  : null;
const credentials = credRaw ? JSON.parse(credRaw) : undefined;
const auth = new google.auth.GoogleAuth({
  credentials,
  keyFile: credentials ? undefined : process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';

// ── 1. Corrected endpoints JSON ───────────────────────────────────────────────
const ENDPOINTS = [
  { path: '/api/v1/Products',      paginationParam: 'rows', responseKey: null },
  { path: '/api/v1/Contacts',      paginationParam: 'rows', responseKey: null },
  { path: '/api/v1/SalesOrders',   paginationParam: 'rows', responseKey: null },
  { path: '/api/v1/PurchaseOrders',paginationParam: 'rows', responseKey: null },
  { path: '/api/v1/Stock',         paginationParam: 'rows', responseKey: null },
  { path: '/api/v1/Branches',      paginationParam: 'rows', responseKey: null },
];

// ── 2. Corrected instructions text ───────────────────────────────────────────
// This restores the original Gemini-generated reference with corrections applied inline.
const INSTRUCTIONS = `\
Here is the complete, official-grade technical reference guide for the **Cin7 Omni REST API (v1)**. 

*Note: This documentation strictly reflects **Cin7 Omni** (formerly just Cin7), and deliberately excludes endpoints, authentication methods, and terminology belonging to Cin7 Core (formerly DEAR Systems).*

---

> ⚠️ **LIVE-TESTED CORRECTIONS (2026-04-30)**
> The following endpoints were confirmed to **NOT EXIST** on this Cin7 Omni account (all return HTTP 404):
> /ProductsList, /SalesOrderLines, /SalesInvoices, /PurchaseOrderLines, /ProductAvailability, /ProductAvailabilities, /Inventory, /StockAdjustments
>
> The correct endpoint for per-branch stock levels is **GET /Stock** (see Section 5 and Section 8 below).
> Endpoints confirmed working (200/401): /Products, /Contacts, /SalesOrders, /PurchaseOrders, /Stock, /Branches

---

# 1. API Overview
The Cin7 Omni API is a RESTful architecture designed to allow bidirectional data flow between Cin7 Omni and external platforms (eCommerce, POS, 3PL, custom reporting). 
*   **Current Version**: v1
*   **Base URL**: \`https://api.cin7.com/api/v1\`
*   **Data Format**: JSON (\`application/json\`)
*   **Structure**: Top-level arrays. Almost all GET requests return a JSON array of objects. POST/PUT requests expect a JSON array of objects.

---

# 2. Authentication
Cin7 Omni uses **HTTP Basic Authentication**.
*   **Username**: Your Cin7 Account ID (Cin7 ID)
*   **Password**: Your API Key
*   **Header Format**: \`Authorization: Basic {Base64(AccountID:APIKey)}\`

**Permissions & Scopes**: 
Cin7 Omni does not use OAuth token scopes. Instead, permissions (Read, Write, Delete) are configured per API connection within the Cin7 Omni backend UI (**Settings > Integrations & API**). If your connection lacks permission for a resource, the API will return a \`403 Forbidden\`.

---

# 3. Rate Limits & Quotas
Cin7 enforces strict rate limiting to ensure system stability.
*   **Requests per Second**: 1 request per second per API connection. Concurrent requests exceeding this will be rejected.
*   **Daily Quota**: 5,000 requests per day (rolling 24-hour window) per API connection.
*   **Exceeding Limits**: The API returns HTTP \`429 Too Many Requests\`. 
*   **Retry Behaviour**: Implement **Exponential Backoff** if a \`429\` is encountered. Do not continuously poll.

---

# 4. Pagination
Cin7 Omni uses page-based pagination. You must include these query parameters on all GET list endpoints.
*   \`rows\`: The number of records to return per page. **Maximum is 250**.
*   \`page\`: The page number to retrieve. Default is \`1\`.
*   **Usage**: \`GET /Products?rows=250&page=1\`
*   **Next Page Logic**: Increment \`page\` by 1 until the array returned contains fewer items than \`rows\` (or is empty), signaling the end of the dataset.

---

# 5. Complete Endpoint Reference

### Products
*   \`GET /Products\`: Retrieve products and their nested \`productOptions\` (variants). Query params: \`rows\`, \`page\`, \`active\`, \`modifiedDate\`. Each product contains a \`productOptions\` array with one entry per variant/SKU. Also includes \`stockOnHand\` and \`stockAvailable\` totals (all branches combined) on each productOption.
*   \`POST /Products\`: Create new products. Body: Array of product objects.
*   \`PUT /Products\`: Update products. Body: Array of product objects (must include \`id\`).
*   \`DELETE /Products/{id}\`: Delete a product by ID.
*   ~~\`GET /ProductsList\`~~: **404 NOT FOUND on this account.** Do not use.

### Stock Levels (Per Branch)
*   \`GET /Stock\`: ✅ CONFIRMED. Retrieve stock levels per variant per branch. Returns one record per \`productOptionId × branchId\`. Includes \`branchName\` directly. Fields: \`productId\`, \`productOptionId\`, \`branchId\`, \`branchName\`, \`styleCode\`, \`code\`, \`barcode\`, \`stockOnHand\`, \`available\` (SOH minus allocated), \`incoming\` (on open POs), \`openSales\` (allocated to unfulfilled orders), \`virtual\`, \`holding\`, \`modifiedDate\`. Query params: \`rows\`, \`page\`, \`modifiedDate\`.
*   ~~\`GET /ProductAvailability\`~~: **404 NOT FOUND.** Use \`GET /Stock\` instead.
*   ~~\`GET /StockAdjustments\`~~: **404 NOT FOUND on this account.**

### Contacts (Customers & Suppliers)
*   \`GET /Contacts\`: Retrieve contacts. Query params: \`rows\`, \`page\`, \`type\` (Customer/Supplier), \`modifiedDate\`.
*   \`POST /Contacts\`: Create new contacts. Body: Array of contact objects.
*   \`PUT /Contacts\`: Update contacts. Body requires contact \`id\`.
*   \`DELETE /Contacts/{id}\`: Delete a contact.

### Sales Orders
*   \`GET /SalesOrders\`: Retrieve sales orders. Query params: \`rows\`, \`page\`, \`modifiedDate\`. Response includes nested \`lineItems\` array.
*   \`POST /SalesOrders\`: Create sales orders. Body: Array of orders including \`lineItems\`.
*   \`PUT /SalesOrders\`: Update sales orders. Body requires order \`id\`.
*   \`DELETE /SalesOrders/{id}\`: Delete a sales order.
*   ~~\`GET /SalesOrderLines\`~~: **404 NOT FOUND.** Access line items via the nested \`lineItems\` array in \`GET /SalesOrders\`.
*   ~~\`GET /SalesInvoices\`~~: **404 NOT FOUND on this account.**

### Purchase Orders
*   \`GET /PurchaseOrders\`: Retrieve purchase orders. Response includes nested \`lineItems\`.
*   \`POST /PurchaseOrders\`: Create new purchase orders. 
*   \`PUT /PurchaseOrders\`: Update existing POs.
*   \`DELETE /PurchaseOrders/{id}\`: Delete a purchase order.
*   ~~\`GET /PurchaseOrderLines\`~~: **404 NOT FOUND.** Access line items via nested \`lineItems\` in \`GET /PurchaseOrders\`.

### Branches (Locations)
*   \`GET /Branches\`: Retrieve all branch locations, their IDs, and types. Note: \`GET /Stock\` also returns \`branchName\` directly, so a separate \`/Branches\` call is usually unnecessary for stock syncs.

### Job Costing (Light Manufacturing / Jobs)
*   \`GET /Jobs\`: Retrieve manufacturing/assembly jobs (unconfirmed — not yet tested live).
*   \`POST /Jobs\`: Create a new job.

### Webhooks
*   \`GET /Webhooks\`: List currently registered webhooks for this connection.
*   \`POST /Webhooks\`: Register a new webhook. Body: \`topic\` and \`address\` (URL).
*   \`PUT /Webhooks\`: Update webhook URL or topic.
*   \`DELETE /Webhooks/{id}\`: Unsubscribe/delete a webhook.

---

# 6. Key Request Parameters & Filters
Cin7 Omni supports specific filtering strings in GET requests to limit data size.
*   **Pagination**: \`page\`, \`rows\` (Required for all lists)
*   **Time Filters**: 
    *   \`modifiedDate\`: Returns records modified on or after a specified ISO 8601 date. Example: \`?modifiedDate=2023-10-01T00:00:00Z\`
    *   \`createdDate\`: Returns records created on or after the specified date.
*   **Status Filters**: \`status\`, \`stage\` (SalesOrders), \`active\` (Products — lowercase boolean).
*   **Field Selection**: \`fields\` (Comma-separated list). Example: \`?fields=id,reference,total\` will return only those 3 fields.
*   **Exact Matches**: \`?reference=WEB-1002\`, \`?code=SKU123\`

---

# 7. Request & Response Structure
**GET Response Structure**
Cin7 Omni does **not** wrap GET responses in a \`"data": []\` envelope. It returns a direct JSON array.

**POST Request Structure**
Must be sent as a JSON array, even when inserting a single record.

**Error Response Format**
Errors are returned as an array of error objects with \`message\` and \`code\` fields.

---

# 8. Most Important Fields for eCommerce Analytics

### **Sales Orders (\`/SalesOrders\`)**
\`id\`, \`createdDate\`, \`modifiedDate\`, \`reference\` (eCommerce order number), \`memberId\` (Contact ID), \`branchId\`, \`status\`, \`stage\`, \`total\`, \`taxTotal\`, \`freightTotal\`, \`currencyCode\`, \`invoiceDate\`

### **Sales Order Line Items (\`lineItems\` array nested in \`/SalesOrders\`)**
\`id\`, \`productId\`, \`productOptionId\`, \`code\` (SKU), \`qty\`, \`price\`, \`discount\`, \`tax\`
Note: There is no standalone /SalesOrderLines endpoint — access via parent SalesOrder.

### **Products (\`/Products\`) & Options**
Product: \`id\`, \`name\`, \`styleCode\`, \`brand\`, \`category\`, \`subCategory\`, \`supplierId\`, \`status\`, \`description\`, \`weight\`, \`width\`, \`length\`, \`height\`, \`volume\`, \`productType\`, \`createdDate\`, \`modifiedDate\`, \`customFields\`
productOptions[]: \`id\`, \`code\` (SKU), \`barcode\`, \`supplierCode\`, \`retailPrice\`, \`cost\` (via priceColumns.costAUD), \`wholesalePrice\`, \`stockOnHand\` (total all branches), \`stockAvailable\` (total available all branches), \`priceColumns\` object, \`status\`, \`option1\`, \`option2\`, \`option3\`, \`size\`

### **Stock Levels (\`/Stock\`) — Per Branch**
\`productOptionId\`, \`branchId\`, \`branchName\`, \`stockOnHand\`, \`available\` (SOH minus openSales), \`incoming\` (on open POs), \`openSales\` (allocated to unfulfilled orders), \`virtual\`, \`holding\`, \`modifiedDate\`

### **Contacts (\`/Contacts\`)**
\`id\`, \`type\` (Customer/Supplier), \`company\`, \`firstName\`, \`lastName\`, \`email\`, \`phone\`, \`mobile\`, \`address1\`, \`city\`, \`state\`, \`postCode\`, \`country\`, \`isActive\`, \`priceColumn\`, \`percentageOff\`, \`creditLimit\`, \`balanceOwing\`, \`onHold\`

---

# 9. Webhook Events
Cin7 Omni sends lightweight notifications (entity + array of changed IDs) to registered webhook URLs. You must then query the API to fetch the full records.
Available triggers: \`Product\`, \`Contact\`, \`SalesOrder\`, \`PurchaseOrder\`

---

# 10. Error Codes
*   \`200 OK\`: Success.
*   \`400 Bad Request\`: Malformed JSON, missing required fields, or validation failure.
*   \`401 Unauthorized\`: Invalid Account ID or API Key. Check Base64 encoding.
*   \`403 Forbidden\`: Valid credentials, but the API connection lacks permission for that resource.
*   \`404 Not Found\`: Endpoint does not exist, or requesting a specific ID that does not exist.
*   \`429 Too Many Requests\`: Exceeded 1 request/sec or 5,000 requests/day.
*   \`500 Internal Server Error\`: Cin7 Omni server failure.

---

# 11. Best Practices
1.  **Incremental Data Syncs**: Always use the \`modifiedDate\` parameter. Store the timestamp of your last successful sync and pass it on the next run.
2.  **Use \`fields\` to Prevent Timeouts**: Append \`&fields=id,createdDate,modifiedDate,total,status\` to reduce payload size.
3.  **Batch Write Operations**: Send one POST with an array of objects rather than many single-record requests.
4.  **Handling \`id\` on Updates**: To PUT any record, you must supply the Cin7 internal \`id\`. Fetch the record first to get it.
5.  **Stock Syncs**: Use \`GET /Stock\` for per-branch levels. Always do a full snapshot (don't filter by modifiedDate) to ensure accuracy. Branch names are included in each record — no separate /Branches call needed.

---

# 12. Recent Changes & Deprecations
*   **Strict Pagination Enforcement**: Always include \`rows\` and \`page\` — unpaginated calls may timeout.
*   **TLS 1.2+ Requirement**: TLS 1.0/1.1 connections are refused.
*   **Rate Limit Headers**: \`X-RateLimit-Limit\` and \`X-RateLimit-Remaining\` headers are returned. Monitor these to pause syncs before hitting 429.
`;

// ── 3. Corrected Schema_cin7 rows ─────────────────────────────────────────────
const SCHEMA_ROWS = [
  ['Field', 'Type', 'Category'],

  // Confirmed endpoints
  ['GET /Products',       'array',  'Endpoint'],
  ['POST /Products',      'array',  'Endpoint'],
  ['PUT /Products',       'array',  'Endpoint'],
  ['DELETE /Products/{id}','object','Endpoint'],
  ['GET /Contacts',       'array',  'Endpoint'],
  ['POST /Contacts',      'array',  'Endpoint'],
  ['PUT /Contacts',       'array',  'Endpoint'],
  ['DELETE /Contacts/{id}','object','Endpoint'],
  ['GET /SalesOrders',    'array',  'Endpoint'],
  ['POST /SalesOrders',   'array',  'Endpoint'],
  ['PUT /SalesOrders',    'array',  'Endpoint'],
  ['DELETE /SalesOrders/{id}','object','Endpoint'],
  ['GET /PurchaseOrders', 'array',  'Endpoint'],
  ['POST /PurchaseOrders','array',  'Endpoint'],
  ['PUT /PurchaseOrders', 'array',  'Endpoint'],
  ['DELETE /PurchaseOrders/{id}','object','Endpoint'],
  ['GET /Stock',          'array',  'Endpoint'],
  ['GET /Branches',       'array',  'Endpoint'],

  // Pagination / filter parameters
  ['rows',         'integer',  'Parameter'],
  ['page',         'integer',  'Parameter'],
  ['modifiedDate', 'datetime', 'Parameter'],
  ['createdDate',  'datetime', 'Parameter'],
  ['fields',       'string',   'Parameter'],
  ['status',       'string',   'Parameter'],
  ['stage',        'string',   'Parameter'],
  ['active',       'boolean',  'Parameter'],
  ['type',         'string',   'Parameter (Contacts: Customer|Supplier)'],

  // Product fields
  ['id',            'integer',  'Product'],
  ['status',        'enum',     'Product'],
  ['createdDate',   'datetime', 'Product'],
  ['modifiedDate',  'datetime', 'Product'],
  ['styleCode',     'string',   'Product'],
  ['name',          'string',   'Product'],
  ['description',   'string',   'Product'],
  ['tags',          'string',   'Product'],
  ['images',        'array',    'Product'],
  ['supplierId',    'integer',  'Product'],
  ['brand',         'string',   'Product'],
  ['category',      'string',   'Product'],
  ['subCategory',   'string',   'Product'],
  ['weight',        'float',    'Product'],
  ['height',        'float',    'Product'],
  ['width',         'float',    'Product'],
  ['length',        'float',    'Product'],
  ['volume',        'float',    'Product'],
  ['productType',   'string',   'Product'],
  ['stockControl',  'integer',  'Product'],
  ['customFields',  'object',   'Product'],
  ['productOptions','array',    'Product'],

  // Product Option (variant) fields
  ['id',              'integer',  'Product Option'],
  ['productId',       'integer',  'Product Option'],
  ['code',            'string',   'Product Option (SKU)'],
  ['barcode',         'string',   'Product Option'],
  ['status',          'enum',     'Product Option'],
  ['supplierCode',    'string',   'Product Option'],
  ['cost',            'currency', 'Product Option (via priceColumns.costAUD)'],
  ['retailPrice',     'currency', 'Product Option'],
  ['stockOnHand',     'integer',  'Product Option (total all branches)'],
  ['stockAvailable',  'integer',  'Product Option (total available all branches)'],
  ['priceColumns',    'object',   'Product Option'],

  // Stock fields (/Stock endpoint — one row per optionId × branchId)
  ['productId',       'integer',  'Stock'],
  ['productOptionId', 'integer',  'Stock'],
  ['branchId',        'integer',  'Stock'],
  ['branchName',      'string',   'Stock'],
  ['styleCode',       'string',   'Stock'],
  ['code',            'string',   'Stock (SKU)'],
  ['barcode',         'string',   'Stock'],
  ['stockOnHand',     'integer',  'Stock'],
  ['available',       'integer',  'Stock (SOH minus allocated)'],
  ['incoming',        'integer',  'Stock (on open purchase orders)'],
  ['openSales',       'integer',  'Stock (allocated to open sales orders)'],
  ['virtual',         'integer',  'Stock (consignment/virtual)'],
  ['holding',         'integer',  'Stock (reserved/on hold)'],
  ['modifiedDate',    'datetime', 'Stock'],

  // Sales Order fields
  ['id',           'integer',  'Sales Order'],
  ['reference',    'string',   'Sales Order'],
  ['memberId',     'integer',  'Sales Order'],
  ['branchId',     'integer',  'Sales Order'],
  ['status',       'string',   'Sales Order'],
  ['stage',        'string',   'Sales Order'],
  ['total',        'currency', 'Sales Order'],
  ['taxTotal',     'currency', 'Sales Order'],
  ['freightTotal', 'currency', 'Sales Order'],
  ['currencyCode', 'string',   'Sales Order'],
  ['createdDate',  'datetime', 'Sales Order'],
  ['modifiedDate', 'datetime', 'Sales Order'],
  ['lineItems',    'array',    'Sales Order (nested)'],

  // Contact fields
  ['id',          'integer', 'Contact'],
  ['type',        'string',  'Contact (Customer|Supplier)'],
  ['isActive',    'boolean', 'Contact'],
  ['company',     'string',  'Contact'],
  ['firstName',   'string',  'Contact'],
  ['lastName',    'string',  'Contact'],
  ['email',       'string',  'Contact'],
  ['phone',       'string',  'Contact'],
  ['mobile',      'string',  'Contact'],
  ['country',     'string',  'Contact'],
  ['priceColumn', 'string',  'Contact'],
  ['creditLimit', 'currency','Contact'],
  ['balanceOwing','currency','Contact'],
  ['modifiedDate','datetime','Contact'],
];

// ── Execute updates ───────────────────────────────────────────────────────────

// Read current APIInstructions to find the cin7 row index
const instrRes = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: 'APIInstructions!A:A',
});
const instrRows = instrRes.data.values || [];
const cin7RowIndex = instrRows.findIndex(r => r[0] === 'cin7');
if (cin7RowIndex < 0) {
  console.error('Could not find cin7 row in APIInstructions');
  process.exit(1);
}
const sheetRow = cin7RowIndex + 1; // 1-based

// Update columns B (instructions) and D (endpoints JSON) for the cin7 row
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: {
    valueInputOption: 'RAW',
    data: [
      {
        range: `APIInstructions!B${sheetRow}`,
        values: [[INSTRUCTIONS]],
      },
      {
        range: `APIInstructions!D${sheetRow}`,
        values: [[JSON.stringify(ENDPOINTS, null, 2)]],
      },
    ],
  },
});
console.log(`Updated APIInstructions row ${sheetRow} (cin7)`);

// Rewrite Schema_cin7 entirely
await sheets.spreadsheets.values.clear({
  spreadsheetId: SPREADSHEET_ID,
  range: 'Schema_cin7',
});
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: 'Schema_cin7!A1',
  valueInputOption: 'RAW',
  requestBody: { values: SCHEMA_ROWS },
});
console.log(`Rewrote Schema_cin7 with ${SCHEMA_ROWS.length} rows`);
console.log('Done.');
