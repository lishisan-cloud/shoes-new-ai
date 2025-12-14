import * as XLSX from 'xlsx';

// --- Data Cleaning Utils ---

export const cleanProductCode = (code: any): string => {
  if (!code) return '';
  // Remove spaces, upper case, remove special chars if needed
  return String(code).trim().toUpperCase();
};

export const extractSalesNum = (raw: any): number => {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const str = String(raw);
  // Extract first sequence of digits
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

export const parseDiscount = (raw: any): number => {
  if (!raw) return 10; 
  const num = parseFloat(String(raw));
  if (isNaN(num)) return 10;
  return num; // Assumes format like 3.6 for 36%
};

// --- Smart Header Detection ---

export const findHeaderRow = (data: any[][]): number => {
  // Scan first 20 rows
  const limit = Math.min(data.length, 20);
  const keywords = ['货号', 'SKU', '款号', 'Product Code', 'Art No', 'ART NO'];

  for (let i = 0; i < limit; i++) {
    const row = data[i];
    // Convert entire row to string for broader matching
    const rowStr = JSON.stringify(row).toLowerCase();
    for (const kw of keywords) {
      if (rowStr.includes(kw.toLowerCase())) {
        return i;
      }
    }
  }
  return 0; // Default to first row if not found
};

// --- Excel File Reader ---

export const readExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        // readAsArrayBuffer is more robust for modern browsers/macOS
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // raw: false ensures we get strings for things like "00123" if needed, 
        // but raw: true is better for numbers. Mixing implies using raw: true and cleaning manually.
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });
        resolve(jsonData as any[]);
      } catch (err) {
        console.error("Excel Read Error:", err);
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

// --- CSV Export ---

export const exportToCSV = (data: any[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename}.csv`);
};