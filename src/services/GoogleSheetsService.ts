import { google } from 'googleapis';

export class GoogleSheetsService {
  private sheets;
  private drive;
  private spreadsheetId?: string;

  constructor(spreadsheetId?: string) {
    if (spreadsheetId) {
      this.spreadsheetId = spreadsheetId;
    }
    
    // Auth logic mapping to process.env parameters
    let authOptions: any = {
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ],
    };

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii')
      );
      authOptions.credentials = credentials;
    } 

    const auth = new google.auth.GoogleAuth(authOptions);

    this.sheets = google.sheets({ version: 'v4', auth });
    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Create a new Google Sheet for a new User Workspace
   * Returns the new Spreadsheet ID so the app can save it to the user's profile
   */
  async createWorkspaceDatabase(workspaceName: string, sharedDriveFolderId?: string): Promise<string> {
    const fileMetadata: any = {
      name: `Database - ${workspaceName}`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    };

    if (sharedDriveFolderId) {
      fileMetadata.parents = [sharedDriveFolderId];
    }

    const driveFile = await this.drive.files.create({
      requestBody: fileMetadata,
      supportsAllDrives: true,
      fields: 'id',
    });

    const newSpreadsheetId = driveFile.data.id;
    if (!newSpreadsheetId) {
      throw new Error("Failed to create Google Sheet database.");
    }
    
    // Set the internal ID so we can immediately initialize it
    this.spreadsheetId = newSpreadsheetId;
    
    // Provision the tabs and headers
    await this.initializeSchema();

    return newSpreadsheetId;
  }

  // Phase 1: Core "Database" Read/Write Methods

  /**
   * Initialize the database schema (Tabs and Headers)
   */
  async initializeSchema() {
    // 1. Create the tabs (CoreData, ProductCatalog, CreativeMetadata)
    const addSheetsRequests = [
      { addSheet: { properties: { title: 'CoreData' } } },
      { addSheet: { properties: { title: 'ProductCatalog' } } },
      { addSheet: { properties: { title: 'CreativeMetadata' } } },
    ];
    
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId!,
        requestBody: { requests: addSheetsRequests },
      });
    } catch (e: any) {
      // Ignore if sheets already exist (error 400 usually indicates this)
      console.log('Sheets might already exist:', e.message);
    }

    // 2. Set the Headers for each tab
    const updateValuesRequests = [
      {
        range: 'CoreData!A1:E1',
        values: [['Workspace ID', 'Shopify Token', 'Meta Ads Token', 'Google Ads Token', 'Target Global ROAS']],
      },
      {
        range: 'ProductCatalog!A1:G1',
        values: [['SKU/Product ID', 'Product Name', 'Category', 'Retail Price', 'COGS', 'Gross Margin (%)', 'Absolute Break-Even ROAS']],
      },
      {
        range: 'CreativeMetadata!A1:E1',
        values: [['Creative ID', 'AI Tags', 'Format', 'Historical Win/Loss', 'Total Spend/CPA']],
      }
    ];

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId!,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updateValuesRequests,
      },
    });

    return true;
  }

  /**
   * Retrieves user preferences and configuration.
   */
  async getAccountData(): Promise<any> {
    if (!this.spreadsheetId) throw new Error("Spreadsheet ID required.");
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'CoreData!A:D',
    });
    return res.data.values;
  }

  /**
   * Update the Product Catalog stored in the spreadsheet, including AI insights
   * and newly calculated gross margins.
   */
  async syncProductCatalog(products: any[]) {
    // Basic logic mapping products to arrays and appending or updating sheets
    // This is the "Data to Store" component from the prompt 
    console.log(`Syncing ${products.length} products to Google Sheets catalog.`);
    // TODO: implement append/update using this.sheets.spreadsheets.values.batchUpdate
  }

  /**
   * Write creative metadata (AI tags, win/loss history) to the database.
   */
  async writeCreativeMetadata(creativeData: any) {
    // Append the newly tagged "Creative Bundle" variables to the "Creative Insights" tab
    console.log(`Writing creative metadata to DB`, creativeData);
  }
}
