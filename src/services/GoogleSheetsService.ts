import { google } from 'googleapis';
import { Readable } from 'stream';

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

    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      // Prioritize direct environment variables for easy hosting management
      authOptions.credentials = {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        // Ensure literal \n strings entered in hosting panels are converted back to real newlines
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      };
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('ascii')
      );
      authOptions.credentials = credentials;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // File path to service account JSON (local dev)
      authOptions.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    const auth = new google.auth.GoogleAuth(authOptions);

    this.sheets = google.sheets({ version: 'v4', auth });
    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Lightweight auth check — calls Drive about.get which just returns the
   * authenticated service account identity. Used by the connections ping.
   */
  async ping(): Promise<string> {
    const res = await this.drive.about.get({ fields: 'user' });
    return res.data.user?.emailAddress || 'authenticated';
  }

  /**
   * Create a new Google Sheet for a new User Workspace.
   * If subfolderName is provided, a dedicated subfolder is created under
   * sharedDriveFolderId first and the spreadsheet is placed inside it.
   * The folder ID is also written to a Config tab in the spreadsheet.
   * Returns { spreadsheetId, folderId }.
   */
  async createWorkspaceDatabase(
    workspaceName: string,
    sharedDriveFolderId?: string,
    subfolderName?: string,
  ): Promise<{ spreadsheetId: string; folderId: string | null }> {
    // 1. Optionally create a per-business subfolder
    let actualFolderId = sharedDriveFolderId || null;
    if (subfolderName && sharedDriveFolderId) {
      actualFolderId = await this.createFolder(subfolderName, sharedDriveFolderId);
    }

    const fileMetadata: any = {
      name: `Database - ${workspaceName}`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    };
    if (actualFolderId) fileMetadata.parents = [actualFolderId];

    const driveFile = await this.drive.files.create({
      requestBody: fileMetadata,
      supportsAllDrives: true,
      fields: 'id',
    });

    const newSpreadsheetId = driveFile.data.id;
    if (!newSpreadsheetId) throw new Error('Failed to create Google Sheet database.');

    this.spreadsheetId = newSpreadsheetId;
    await this.initializeSchema();

    // 2. Write FolderID to a Config tab in the spreadsheet
    if (actualFolderId) {
      await this.addSheetIfNotExists(newSpreadsheetId, 'Config', ['Key', 'Value']);
      await this.appendData(newSpreadsheetId, 'Config', [['FolderID', actualFolderId]]);
    }

    return { spreadsheetId: newSpreadsheetId, folderId: actualFolderId };
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
    console.log(`Syncing ${products.length} products to Google Sheets catalog.`);
    
    if (!this.spreadsheetId) {
      throw new Error("Cannot sync catalog: Spreadsheet ID is not set.");
    }
    
    // Map StandardizedProduct array back into rows for the 'ProductCatalog' tab
    // Headers: ['SKU/Product ID', 'Product Name', 'Category', 'Retail Price', 'COGS', 'Gross Margin (%)', 'Absolute Break-Even ROAS']
    const productRows = products.map(p => [
      p.id,
      p.name,
      p.category || 'Uncategorized',
      p.price,
      '', // COGS (to be filled by user)
      '', // Gross Margin (Formula goes here later)
      ''  // Break-Even ROAS (Formula goes here later)
    ]);

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'ProductCatalog!A2',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: productRows
      }
    });
  }

  /**
   * Write creative metadata (AI tags, win/loss history) to the database.
   */
  async writeCreativeMetadata(creativeData: any) {
    // Append the newly tagged "Creative Bundle" variables to the "Creative Insights" tab
    console.log(`Writing creative metadata to DB`, creativeData);
  }

  /**
   * Find an existing spreadsheet by name in a Drive folder, or create it if not found.
   * Uses Drive files.list to search first so it is idempotent.
   */
  async findOrCreateSpreadsheet(name: string, folderId: string): Promise<string> {
    // Escape single quotes in the name for the Drive query
    const safeName = name.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q: `name='${safeName}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    if (res.data.files?.length) return res.data.files[0].id!;

    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId],
      },
      supportsAllDrives: true,
      fields: 'id',
    });
    if (!created.data.id) throw new Error(`Failed to create spreadsheet: ${name}`);
    return created.data.id;
  }

  /**
   * Find an existing spreadsheet by name in a Drive folder.
   * Returns null when not found (does not create anything).
   */
  async findSpreadsheetInFolder(name: string, folderId: string): Promise<string | null> {
    const safeName = name.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q: `name='${safeName}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1,
    });
    return res.data.files?.[0]?.id ?? null;
  }

  /**
   * Create a blank spreadsheet without generating the default templates.
   */
  async createBlankSpreadsheet(name: string, sharedDriveFolderId?: string): Promise<string> {
    const fileMetadata: any = {
      name: name,
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

    if (!driveFile.data.id) throw new Error("Failed to create spreadsheet");
    return driveFile.data.id;
  }

  /**
   * Generic method to append data to an arbitrary spreadsheet and range.
   */
  async appendData(spreadsheetId: string, range: string, values: any[][]) {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }

  /**   * Adds a new sheet correctly safely handling if it already exists
   */
  async addSheetIfNotExists(spreadsheetId: string, title: string, headers?: string[]) {
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { 
          requests: [{ addSheet: { properties: { title } } }] 
        },
      });

      if (headers && headers.length > 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${title}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [headers] },
        });
      }
      return true;
    } catch (e: any) {
      console.log(`Sheet ${title} might already exist: ${e.message}`);
      return false;
    }
  }

  /**   * Generic method to retrieve data from an arbitrary spreadsheet and range.
   */
  async getData(spreadsheetId: string, range: string): Promise<any[][] | undefined> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return res.data.values;
  }

  /**
   * Generic method to update and overwrite data in a specific spreadsheet range.
   */
  async updateData(spreadsheetId: string, range: string, values: any[][]) {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  /**
   * Clears all content from a sheet tab (but keeps the tab itself).
   */
  async clearSheetContent(spreadsheetId: string, sheetName: string) {
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });
  }

  /**
   * Fully resets a sheet by deleting it and recreating it from scratch.
   * Unlike clearSheetContent (which only clears values), this removes all
   * allocated rows so they no longer count against the 10M cell limit.
   * Optionally writes a header row on the fresh sheet.
   */
  async resetSheet(spreadsheetId: string, sheetName: string, headers?: string[]): Promise<void> {
    // Find existing sheet ID
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
    const existing = meta.data.sheets?.find(s => s.properties?.title === sheetName);
    if (existing?.properties?.sheetId != null) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }] },
      });
    }
    // Recreate fresh
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    if (headers && headers.length > 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
    }
  }

  /**
   * Finds an existing folder by name inside a parent folder, or creates it if absent.
   */
  async findOrCreateFolder(name: string, parentFolderId: string): Promise<string> {
    const safeName = name.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q: `name='${safeName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1,
    });
    if (res.data.files?.length) return res.data.files[0].id!;
    return this.createFolder(name, parentFolderId);
  }

  /**
   * Creates a folder in Google Drive and returns its ID.
   */
  async createFolder(name: string, parentFolderId?: string): Promise<string> {
    const fileMetadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentFolderId) fileMetadata.parents = [parentFolderId];

    const res = await this.drive.files.create({
      requestBody: fileMetadata,
      supportsAllDrives: true,
      fields: 'id',
    });
    if (!res.data.id) throw new Error(`Failed to create folder "${name}"`);
    return res.data.id;
  }

  /** Delete a file or folder from Google Drive by ID. Silently ignores 404. */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.drive.files.delete({ fileId, supportsAllDrives: true });
    } catch (err: any) {
      if (err?.code !== 404) throw err;
    }
  }

  /** Upload a private (non-public) text file to Drive. Returns the file ID. */
  async uploadPrivateFile(content: string, filename: string, mimeType: string, folderId: string): Promise<string> {
    const body = Readable.from(Buffer.from(content, 'utf8'));
    const res = await this.drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body },
      supportsAllDrives: true,
      fields: 'id',
    });
    if (!res.data.id) throw new Error('Drive upload failed — no file ID returned');
    return res.data.id;
  }

  /** List files in a Drive folder, oldest first. */
  async listFilesInFolder(folderId: string): Promise<Array<{ id: string; name: string; createdTime: string }>> {
    const results: Array<{ id: string; name: string; createdTime: string }> = [];
    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,createdTime)',
        orderBy: 'createdTime asc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      results.push(...((res.data.files ?? []) as Array<{ id: string; name: string; createdTime: string }>));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return results;
  }

  /**
   * Upload a file to Google Drive (base64-encoded content).
   * Makes the file publicly readable and returns a direct-view URL.
   */
  async uploadFileToDrive(
    base64: string,
    mimeType: string,
    filename: string,
    folderId: string,
  ): Promise<string> {
    const buffer = Buffer.from(base64, 'base64');
    const body = Readable.from(buffer);

    const res = await this.drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body },
      supportsAllDrives: true,
      fields: 'id',
    });

    const fileId = res.data.id;
    if (!fileId) throw new Error('Drive upload failed — no file ID returned');

    await this.drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  }

  /**
   * Moves a file into a new folder (optionally removing it from the old one).
   */
  async moveFileToFolder(fileId: string, newFolderId: string, oldFolderId?: string): Promise<void> {
    const params: any = {
      fileId,
      addParents: newFolderId,
      supportsAllDrives: true,
      fields: 'id',
    };
    if (oldFolderId) params.removeParents = oldFolderId;
    await this.drive.files.update(params);
  }

}

