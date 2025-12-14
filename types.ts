export enum DataType {
  MARKET = 'market',     // Dewu/Nice (Has Price)
  SUPPLIER = 'supplier', // Tianma (Has Discount, Sales)
  INVENTORY = 'inventory',
  FUTURE = 'future'
}

export interface ShoeRecord {
  id: string; // Unique ID for React keys
  productCode: string; // SKU
  size: string;
  price: number; // For Market
  discount: number; // For Supplier (e.g. 3.6)
  salesNum: number; // Cleaned integer
  salesRaw: string; // Original text "3000+"
  platform: string;
  sourceFile?: string; // The name of the uploaded Excel file
  dataType: DataType;
  updateDate: string;
}

export interface Channel {
  name: string;
  isRemovable: boolean;
}

export interface SalesHistoryItem {
  date: string;
  file: string;
  sales: number;
  platform: string;
}

export interface ArbitrageResult {
  productCode: string;
  tagPrice: number;
  costPrice: number; // Tag * Discount
  marketPrice: number; // Dewu Price
  netRevenue: number; // Market * 0.88
  profit: number;
  roi: number;
  supplierName: string; // Platform Name
  supplierSourceFile?: string; // Filename of the source
  supplierDate: string; // Date of the matched supplier record
  salesVolume: number; // Max sales found or reference sales
  salesHistory?: SalesHistoryItem[]; // History of sales from different files
  inventoryCount: number;
  futureCount: number;
}

// For Excel Import Rows (Loose typing for raw data)
export type ExcelRow = Record<string, any>;