import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, Trash2, AlertCircle, RefreshCw, Plus, Save, X, Files, ArrowRight, Table, Check, Bookmark, Download } from 'lucide-react';
import { ShoeRecord, DataType, Channel } from '../types';
import { findHeaderRow, readExcelFile, cleanProductCode, extractSalesNum, parseDiscount, exportToCSV } from '../utils';

interface DataManagerProps {
  data: ShoeRecord[];
  setData: React.Dispatch<React.SetStateAction<ShoeRecord[]>>;
  channels: Channel[];
}

interface PendingFile {
  id: string;
  file: File;
  rawData: any[];
  guessedHeaderIndex: number;
  headerSignature: string; // Unique signature based on header names
  autoMap: { sku: number; size: number; price: number; discount: number; sales: number };
}

interface SavedMapping {
  signature: string;
  map: {
    sku: number;
    size: number;
    price: number;
    discount: number;
    sales: number;
  };
  name: string;
}

// Temporary ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

const DataManager: React.FC<DataManagerProps> = ({ data, setData, channels }) => {
  const [activeMode, setActiveMode] = useState<'upload' | 'manual' | 'export'>('upload');
  const [loading, setLoading] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string>(channels[0]?.name || '');
  const [selectedType, setSelectedType] = useState<DataType>(DataType.SUPPLIER);
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clear Data Confirmation State
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  // Manual Mapping State
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [currentMappingFile, setCurrentMappingFile] = useState<PendingFile | null>(null);
  const [colMapping, setColMapping] = useState<{
    sku: string;
    size: string;
    price: string;
    discount: string;
    sales: string;
  }>({ sku: '', size: '', price: '', discount: '', sales: '' });
  
  // Smart Mapping State
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>(() => {
      try {
          const saved = localStorage.getItem('erp_saved_mappings');
          return saved ? JSON.parse(saved) : [];
      } catch (e) { return []; }
  });
  const [rememberMapping, setRememberMapping] = useState(true);

  // Manual Entry State
  const [manualRows, setManualRows] = useState<Partial<ShoeRecord>[]>([
    { id: generateId(), productCode: '', price: 0, discount: 10, salesRaw: '0', size: '' }
  ]);

  useEffect(() => {
      localStorage.setItem('erp_saved_mappings', JSON.stringify(savedMappings));
  }, [savedMappings]);

  // Pre-fill mapping modal with auto-detected values when file changes
  useEffect(() => {
    if (currentMappingFile) {
        const m = currentMappingFile.autoMap;
        setColMapping({
            sku: m.sku !== -1 ? String(m.sku) : '',
            size: m.size !== -1 ? String(m.size) : '',
            price: m.price !== -1 ? String(m.price) : '',
            discount: m.discount !== -1 ? String(m.discount) : '',
            sales: m.sales !== -1 ? String(m.sales) : ''
        });
    } else {
        setColMapping({ sku: '', size: '', price: '', discount: '', sales: '' });
    }
  }, [currentMappingFile]);

  // --- Core Extraction Logic ---
  const extractRecords = (
      rawData: any[], 
      headerIndex: number, 
      map: Record<string, number>, 
      fileName: string,
      platform: string,
      type: DataType
  ): { records: ShoeRecord[], errors: string[] } => {
      const newRecords: ShoeRecord[] = [];
      const validationErrors: string[] = [];
      const today = new Date().toISOString().split('T')[0];

      for (let i = headerIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;

        // map['sku'] might be -1 if not found, check before access
        if (map.sku === -1 || row[map.sku] === undefined) continue;

        const skuRaw = row[map.sku];
        const sku = cleanProductCode(skuRaw);
        if (!sku) continue; // Skip empty rows

        let price = 0;
        let discount = 10;
        let salesRaw = '0';
        let salesNum = 0;
        let size = '-';

        // 1. Price Validation (Critical for Market)
        if (map.price !== -1) {
            const pVal = row[map.price];
            if (pVal !== undefined && String(pVal).trim() !== '') {
                 const pNum = parseFloat(String(pVal));
                 if (isNaN(pNum)) {
                     validationErrors.push(`行 ${i+1} [SKU: ${sku}]: 价格格式错误 (值: "${pVal}")。建议: 去除货币符号(¥/$)或文本，仅保留数字。`);
                     if (type === DataType.MARKET) continue; 
                 } else if (pNum < 0) {
                     validationErrors.push(`行 ${i+1} [SKU: ${sku}]: 价格不能为负数 (值: "${pVal}")。`);
                     if (type === DataType.MARKET) continue;
                 } else {
                     price = pNum;
                 }
            } else if (type === DataType.MARKET) {
                 validationErrors.push(`行 ${i+1} [SKU: ${sku}]: 价格缺失。市场数据必须包含价格。`);
                 continue;
            }
        }

        // 2. Discount Validation (Critical for Supplier)
        if (map.discount !== -1) {
            const dVal = row[map.discount];
             if (dVal !== undefined && String(dVal).trim() !== '') {
                const dNum = parseFloat(String(dVal));
                if (isNaN(dNum)) {
                    validationErrors.push(`行 ${i+1} [SKU: ${sku}]: 折扣格式错误 (值: "${dVal}")。建议: 使用数字格式 (如 6.5 表示 65折)。`);
                    if (type === DataType.SUPPLIER) continue;
                } else {
                    discount = parseDiscount(dVal);
                }
            }
        }

        // 3. Sales
        if (map.sales !== -1 && row[map.sales] !== undefined) {
             salesRaw = String(row[map.sales]);
             salesNum = extractSalesNum(salesRaw);
        }

        // 4. Size
        if (map.size !== -1 && row[map.size] !== undefined) {
            size = String(row[map.size]);
        }

        const record: ShoeRecord = {
          id: `${sku}-${platform}-${fileName}-${i}-${Date.now()}`,
          productCode: sku,
          size: size,
          price: price,
          discount: discount,
          salesRaw: salesRaw,
          salesNum: salesNum,
          platform: platform,
          sourceFile: fileName,
          dataType: type,
          updateDate: today
        };
        newRecords.push(record);
      }
      return { records: newRecords, errors: validationErrors };
  };

  const autoDetectColumns = (headerRow: any[]) => {
      const map = { sku: -1, size: -1, price: -1, discount: -1, sales: -1 };
      headerRow.forEach((col, idx) => {
        const c = String(col).trim();
        // Loose matching
        if (['货号', 'SKU', '款号', 'Product Code', 'Art No'].some(k => c.includes(k))) map.sku = idx;
        if (['尺码', 'Size', '码数'].some(k => c.includes(k))) map.size = idx;
        if (['平台最低价', 'Price', '价格', 'Tag Price', '牌价', '原价'].some(k => c.includes(k))) map.price = idx;
        if (['平台平均下单折扣', '折扣', 'Discount'].some(k => c.includes(k))) map.discount = idx;
        if (['销量', 'Sales', '累计销量', '热度', '库存', 'Quantity'].some(k => c.includes(k))) map.sales = idx;
      });
      return map;
  };

  // --- Excel Batch Upload Handler ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setMessage(null);
    setPendingFiles([]); // Clear previous queue
    setCurrentMappingFile(null);

    let allNewRecords: ShoeRecord[] = [];
    let successCount = 0;
    const mappingQueue: PendingFile[] = []; 
    const errors: string[] = [];

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const rawData = await readExcelFile(file);
                if (!rawData || rawData.length === 0) {
                     errors.push(`${file.name}: 文件内容为空`);
                     continue;
                }

                const headerIndex = findHeaderRow(rawData);
                // Safe access to header row
                const headerRow = rawData[headerIndex] ? rawData[headerIndex].map(c => String(c).trim()) : [];
                const headerSignature = headerRow.join('|');
                
                // 1. Check Saved Mappings
                const savedMap = savedMappings.find(m => m.signature === headerSignature);
                
                let colMap = { sku: -1, size: -1, price: -1, discount: -1, sales: -1 };
                let usedSavedMap = false;

                if (savedMap) {
                    colMap = savedMap.map;
                    usedSavedMap = true;
                } else {
                    // 2. Try Auto-Detect
                    colMap = autoDetectColumns(headerRow);
                }

                // Check mandatory field logic
                let isComplete = colMap.sku !== -1;
                
                // For MARKET data, Price is mandatory
                if (selectedType === DataType.MARKET && colMap.price === -1) {
                    isComplete = false;
                }
                
                // For INVENTORY/FUTURE, Sales (Quantity) is mandatory
                if ((selectedType === DataType.INVENTORY || selectedType === DataType.FUTURE) && colMap.sales === -1) {
                    isComplete = false;
                }
                
                // If using a saved map, we trust it matches the user's intent even if some fields are missing
                if (usedSavedMap) isComplete = true;

                if (isComplete) {
                    // Success: Auto-extract
                    const { records, errors: fileErrors } = extractRecords(rawData, headerIndex, colMap, file.name, selectedPlatform, selectedType);
                    
                    if (fileErrors.length > 0) {
                        errors.push(`--- ${file.name} 警告 ---\n${fileErrors.join('\n')}`);
                    }

                    if (records.length > 0) {
                        allNewRecords.push(...records);
                        successCount++;
                    }
                } else {
                    // Fail: Add to mapping queue
                    mappingQueue.push({ 
                        id: generateId(), 
                        file, 
                        rawData, 
                        guessedHeaderIndex: headerIndex,
                        headerSignature,
                        autoMap: colMap // Store the guess to pre-fill the modal
                    });
                }
            } catch (err: any) {
                console.error(err);
                errors.push(`${file.name}: 解析错误 - ${err.message}`);
            }
        }
      
        // Commit auto-success records
        if (allNewRecords.length > 0) {
            setData(prev => {
                const filtered = prev.filter(p => !(p.platform === selectedPlatform && p.dataType === selectedType));
                return [...filtered, ...allNewRecords];
            });
        }

        // Handle outcomes
        if (mappingQueue.length > 0) {
             setPendingFiles(mappingQueue);
             // Start mapping the first one
             setCurrentMappingFile(mappingQueue[0]);
             if (successCount > 0) {
                 setMessage({ type: 'success', text: `已自动导入 ${successCount} 个文件。剩余 ${mappingQueue.length} 个文件需要手动指定表头。` });
             }
        } else {
             // All done
             if (errors.length > 0) {
                 // Use whitespace-pre-wrap in CSS to display newlines
                 setMessage({ type: 'error', text: `导入完成，但发现以下问题:\n\n${errors.join('\n\n')}` });
             } else {
                 setMessage({ type: 'success', text: `批量导入成功! 共 ${successCount} 个文件, ${allNewRecords.length} 条数据` });
             }
        }

    } catch (err: any) {
        setMessage({ type: 'error', text: "系统错误: " + (err.message || "未知错误") });
    } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Manual Mapping Handlers ---
  const handleConfirmMapping = () => {
      if (!currentMappingFile) return;
      if (colMapping.sku === '') {
          alert("请至少选择“货号 (SKU)”对应的列");
          return;
      }

      const map = {
          sku: parseInt(colMapping.sku),
          size: colMapping.size ? parseInt(colMapping.size) : -1,
          price: colMapping.price ? parseInt(colMapping.price) : -1,
          discount: colMapping.discount ? parseInt(colMapping.discount) : -1,
          sales: colMapping.sales ? parseInt(colMapping.sales) : -1
      };

      try {
          const { records, errors } = extractRecords(
              currentMappingFile.rawData,
              currentMappingFile.guessedHeaderIndex,
              map,
              currentMappingFile.file.name,
              selectedPlatform,
              selectedType
          );

          if (records.length > 0) {
            setData(prev => [...prev, ...records]);
          }

          if (errors.length > 0) {
             alert(`导入成功 ${records.length} 条，但以下行存在数据问题:\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? '\n...更多错误未显示' : ''}`);
          }

          // Save Mapping if requested
          if (rememberMapping) {
              setSavedMappings(prev => {
                  // Remove existing with same signature if any
                  const filtered = prev.filter(m => m.signature !== currentMappingFile.headerSignature);
                  return [...filtered, {
                      signature: currentMappingFile.headerSignature,
                      map,
                      name: `Auto-saved (${new Date().toLocaleTimeString()})`
                  }];
              });
          }

          // Move to next file
          const remaining = pendingFiles.filter(f => f.id !== currentMappingFile.id);
          setPendingFiles(remaining);
          
          if (remaining.length > 0) {
              setCurrentMappingFile(remaining[0]);
              // colMapping reset is handled by useEffect
          } else {
              setCurrentMappingFile(null);
              setMessage({ type: 'success', text: "所有文件已手动映射并导入完成！" });
          }

      } catch (e: any) {
          alert("映射解析失败: " + e.message);
      }
  };

  const handleSkipFile = () => {
      if (!currentMappingFile) return;
      const remaining = pendingFiles.filter(f => f.id !== currentMappingFile.id);
      setPendingFiles(remaining);
      if (remaining.length > 0) {
          setCurrentMappingFile(remaining[0]);
          // colMapping reset is handled by useEffect
      } else {
          setCurrentMappingFile(null);
      }
  };

  // --- Export Handler ---
  const handleExportData = () => {
      const filtered = data.filter(d => d.platform === selectedPlatform && d.dataType === selectedType);
      
      if (filtered.length === 0) {
          setMessage({ type: 'error', text: "当前筛选条件下没有数据可导出" });
          return;
      }

      const csvData = filtered.map(item => ({
         "货号/SKU": item.productCode,
         "尺码": item.size,
         "价格": item.price,
         "折扣": item.discount,
         "销量(原始)": item.salesRaw,
         "销量(数字)": item.salesNum,
         "平台": item.platform,
         "类型": getShortDataTypeLabel(item.dataType),
         "来源文件": item.sourceFile || '手动录入',
         "更新日期": item.updateDate
      }));

      const filename = `${selectedPlatform}_${getShortDataTypeLabel(selectedType)}_数据导出_${new Date().toISOString().split('T')[0]}`;
      exportToCSV(csvData, filename);
      setMessage({ type: 'success', text: `成功导出 ${filtered.length} 条数据` });
  };

  // --- Manual Entry Handlers (Unchanged) ---
  const addManualRow = () => {
    setManualRows([...manualRows, { id: generateId(), productCode: '', price: 0, discount: 10, salesRaw: '0', size: '' }]);
  };

  const removeManualRow = (id: string) => {
    setManualRows(manualRows.filter(r => r.id !== id));
  };

  const updateManualRow = (id: string, field: keyof ShoeRecord, value: any) => {
    setManualRows(manualRows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const saveManualData = () => {
    const validRows = manualRows.filter(r => r.productCode && r.productCode.trim() !== '');
    if (validRows.length === 0) {
      setMessage({ type: 'error', text: "请至少输入一条有效的 SKU 数据" });
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const newRecords: ShoeRecord[] = validRows.map(r => ({
      id: `${r.productCode}-${selectedPlatform}-${Date.now()}-${Math.random()}`,
      productCode: cleanProductCode(r.productCode),
      size: r.size || '-',
      price: Number(r.price) || 0,
      discount: Number(r.discount) || 10,
      salesRaw: String(r.salesRaw || '0'),
      salesNum: extractSalesNum(r.salesRaw),
      platform: selectedPlatform,
      sourceFile: 'Manual Entry',
      dataType: selectedType,
      updateDate: today
    }));

    setData(prev => [...prev, ...newRecords]);
    setMessage({ type: 'success', text: `成功手动录入 ${newRecords.length} 条数据` });
    setManualRows([{ id: generateId(), productCode: '', price: 0, discount: 10, salesRaw: '0', size: '' }]);
  };

  // --- Clear Data Handlers ---
  const handleClearRequest = () => setIsConfirmingClear(true);
  const handleConfirmClear = () => {
    setData([]);
    setMessage({ type: 'success', text: '数据库已成功清空' });
    setIsConfirmingClear(false);
  };
  const handleCancelClear = () => setIsConfirmingClear(false);

  const getShortDataTypeLabel = (type: DataType) => {
    switch (type) {
      case DataType.MARKET: return '市场';
      case DataType.SUPPLIER: return '供应商';
      case DataType.INVENTORY: return '库存';
      case DataType.FUTURE: return '期货';
      default: return type;
    }
  };

  // --- Render Helpers ---
  const renderColumnOptions = (headers: any[]) => {
      const options = [];
      const maxCols = Math.max(headers.length, 10);
      
      for (let i = 0; i < maxCols; i++) {
          const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          const colLabel = i < 26 ? letters[i] : `Col${i}`;
          const headerVal = headers[i] ? ` - ${headers[i]}` : '';
          options.push(
              <option key={i} value={i}>{`列 ${colLabel}${headerVal}`}</option>
          );
      }
      return options;
  };

  const filteredCount = data.filter(d => d.platform === selectedPlatform && d.dataType === selectedType).length;

  return (
    <div className="p-8 space-y-6 relative">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">数据中心</h2>
        
        {isConfirmingClear ? (
             <div className="flex items-center gap-3 bg-red-50 px-4 py-2 rounded-lg border border-red-100 animate-in fade-in duration-200">
                <span className="text-sm text-red-700 font-medium">⚠️ 确定清空所有数据？不可恢复！</span>
                <button onClick={handleConfirmClear} className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 transition font-bold">确认清空</button>
                <button onClick={handleCancelClear} className="text-xs bg-white text-gray-700 px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 transition">取消</button>
            </div>
        ) : (
            <button onClick={handleClearRequest} className="flex items-center gap-2 text-red-500 hover:text-red-700 px-4 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition">
                <Trash2 size={16} /> 清空数据库
            </button>
        )}
      </div>

      {/* Main Action Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex border-b border-gray-100">
            <button 
                onClick={() => setActiveMode('upload')}
                className={`px-6 py-4 text-sm font-medium transition ${activeMode === 'upload' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
                Excel 批量导入
            </button>
            <button 
                onClick={() => setActiveMode('manual')}
                className={`px-6 py-4 text-sm font-medium transition ${activeMode === 'manual' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
                批量手动录入
            </button>
            <button 
                onClick={() => setActiveMode('export')}
                className={`px-6 py-4 text-sm font-medium transition ${activeMode === 'export' ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
                数据导出
            </button>
        </div>

        <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">选择平台</label>
                    <select 
                        className="w-full border border-gray-300 rounded-lg p-2.5 bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={selectedPlatform}
                        onChange={(e) => setSelectedPlatform(e.target.value)}
                    >
                    {channels.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">数据类型</label>
                    <select 
                        className="w-full border border-gray-300 rounded-lg p-2.5 bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={selectedType}
                        onChange={(e) => setSelectedType(e.target.value as DataType)}
                    >
                    <option value={DataType.SUPPLIER}>供应商 (有折扣，无价格)</option>
                    <option value={DataType.MARKET}>市场 (有价格，如得物)</option>
                    <option value={DataType.INVENTORY}>自有库存 (现货)</option>
                    <option value={DataType.FUTURE}>期货 (在途/订单)</option>
                    </select>
                </div>
            </div>

            {/* UPLOAD MODE */}
            {activeMode === 'upload' && (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition cursor-pointer relative group">
                    <input 
                        type="file" 
                        ref={fileInputRef}
                        accept=".xlsx, .xls, .csv" 
                        multiple 
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    {loading ? (
                        <div className="flex flex-col items-center">
                            <RefreshCw className="animate-spin text-blue-600 mb-2" size={32} />
                            <p className="text-gray-500">正在解析批量数据...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center group-hover:scale-105 transition-transform duration-200">
                            <div className="relative">
                                <FileSpreadsheet className="text-gray-400 mb-3" size={40} />
                                <Files className="absolute -right-2 -bottom-0 text-blue-500 bg-white rounded-full p-0.5 shadow-sm" size={20} />
                            </div>
                            <p className="text-gray-900 font-medium">点击上传 Excel 文件 (支持多选)</p>
                            <p className="text-sm text-gray-500 mt-1">系统会自动识别表头。如果识别失败，将引导您手动匹配。</p>
                        </div>
                    )}
                </div>
            )}

            {/* MANUAL MODE */}
            {activeMode === 'manual' && (
                <div className="space-y-4">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 w-10">#</th>
                                    <th className="px-3 py-2">货号 (SKU)*</th>
                                    <th className="px-3 py-2">尺码</th>
                                    {selectedType === DataType.MARKET ? (
                                        <th className="px-3 py-2">价格 (¥)</th>
                                    ) : (
                                        <th className="px-3 py-2">折扣 (例如 3.6)</th>
                                    )}
                                    <th className="px-3 py-2">销量/数量</th>
                                    <th className="px-3 py-2 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {manualRows.map((row, index) => (
                                    <tr key={row.id}>
                                        <td className="px-3 py-2 text-gray-400">{index + 1}</td>
                                        <td className="px-3 py-2">
                                            <input 
                                                type="text" 
                                                className="w-full border-gray-300 rounded focus:ring-blue-500 text-sm p-1 border"
                                                placeholder="货号"
                                                value={row.productCode}
                                                onChange={(e) => updateManualRow(row.id as string, 'productCode', e.target.value)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input 
                                                type="text" 
                                                className="w-full border-gray-300 rounded focus:ring-blue-500 text-sm p-1 border"
                                                placeholder="尺码"
                                                value={row.size}
                                                onChange={(e) => updateManualRow(row.id as string, 'size', e.target.value)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            {selectedType === DataType.MARKET ? (
                                                <input 
                                                    type="number" 
                                                    className="w-full border-gray-300 rounded focus:ring-blue-500 text-sm p-1 border"
                                                    placeholder="0"
                                                    value={row.price}
                                                    onChange={(e) => updateManualRow(row.id as string, 'price', e.target.value)}
                                                />
                                            ) : (
                                                <input 
                                                    type="number" 
                                                    step="0.1"
                                                    className="w-full border-gray-300 rounded focus:ring-blue-500 text-sm p-1 border"
                                                    placeholder="10"
                                                    value={row.discount}
                                                    onChange={(e) => updateManualRow(row.id as string, 'discount', e.target.value)}
                                                />
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <input 
                                                type="text" 
                                                className="w-full border-gray-300 rounded focus:ring-blue-500 text-sm p-1 border"
                                                placeholder="0"
                                                value={row.salesRaw}
                                                onChange={(e) => updateManualRow(row.id as string, 'salesRaw', e.target.value)}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <button onClick={() => removeManualRow(row.id as string)} className="text-gray-400 hover:text-red-500">
                                                <X size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={addManualRow} className="flex items-center gap-1 text-sm text-blue-600 hover:bg-blue-50 px-3 py-2 rounded">
                            <Plus size={16} /> 添加一行
                        </button>
                        <div className="flex-1"></div>
                        <button onClick={saveManualData} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm shadow-sm transition">
                            <Save size={16} /> 保存数据
                        </button>
                    </div>
                </div>
            )}

            {/* EXPORT MODE */}
            {activeMode === 'export' && (
                <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 animate-in fade-in duration-300">
                     <div className="bg-blue-50 p-4 rounded-full text-blue-600 mb-2">
                         <Download size={32} />
                     </div>
                     <div>
                         <h3 className="text-lg font-medium text-gray-900">导出数据</h3>
                         <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                            将当前选择的 <span className="font-bold text-gray-700">{selectedPlatform}</span> 平台下的 <span className="font-bold text-gray-700">{getShortDataTypeLabel(selectedType)}</span> 数据导出为 CSV 文件。
                         </p>
                     </div>
                     
                     <div className="bg-gray-50 px-6 py-3 rounded-lg border border-gray-100 flex items-center gap-8 mt-2">
                         <div className="text-left">
                             <span className="block text-xs text-gray-400">当前匹配记录</span>
                             <span className="text-2xl font-bold text-gray-800">
                                 {filteredCount}
                             </span>
                         </div>
                         <div className="h-8 w-px bg-gray-200"></div>
                         <button 
                            onClick={handleExportData}
                            disabled={filteredCount === 0}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg flex items-center gap-2 font-medium shadow-sm transition"
                         >
                            <Download size={18} />
                            确认导出
                         </button>
                     </div>
                </div>
            )}

            {message && (
            <div className={`mt-4 p-3 rounded-lg flex items-start gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span className="whitespace-pre-wrap text-sm">{message.text}</span>
            </div>
            )}
        </div>
      </div>

      {/* MAPPING MODAL OVERLAY */}
      {currentMappingFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                      <div>
                        <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            <Table className="text-blue-600" size={24}/>
                            需确认表头映射
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                            自动识别不完整或失败。请为文件 <span className="font-mono font-medium text-gray-700 bg-gray-100 px-1 rounded">{currentMappingFile.file.name}</span> 手动匹配列。
                        </p>
                      </div>
                      <div className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
                          剩余待处理: {pendingFiles.length - 1}
                      </div>
                  </div>

                  <div className="p-6 overflow-y-auto flex-1 space-y-6">
                      {/* Data Preview */}
                      <div className="space-y-2">
                          <p className="text-xs font-bold text-gray-500 uppercase">数据前 5 行预览</p>
                          <div className="overflow-x-auto border border-gray-200 rounded-lg">
                              <table className="w-full text-xs text-left whitespace-nowrap">
                                  <thead className="bg-gray-50 text-gray-500">
                                      <tr>
                                          <th className="px-2 py-1 border-r w-10">#</th>
                                          {currentMappingFile.rawData[currentMappingFile.guessedHeaderIndex]?.map((h: any, i: number) => (
                                              <th key={i} className="px-3 py-2 border-r last:border-0 font-medium text-gray-700">
                                                  {i < 26 ? String.fromCharCode(65 + i) : i}: {h}
                                              </th>
                                          ))}
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                      {currentMappingFile.rawData.slice(currentMappingFile.guessedHeaderIndex + 1, currentMappingFile.guessedHeaderIndex + 6).map((row, idx) => (
                                          <tr key={idx}>
                                              <td className="px-2 py-1 border-r text-gray-400 bg-gray-50">{idx + 1}</td>
                                              {row.map((cell: any, cIdx: number) => (
                                                  <td key={cIdx} className="px-3 py-2 border-r last:border-0 truncate max-w-[150px]">
                                                      {String(cell)}
                                                  </td>
                                              ))}
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>

                      {/* Mapping Form */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-blue-50/50 p-6 rounded-xl border border-blue-100">
                           <div className="col-span-full md:col-span-1">
                                <label className="block text-sm font-semibold text-gray-800 mb-2">
                                    货号 / SKU (必填) <span className="text-red-500">*</span>
                                </label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    value={colMapping.sku}
                                    onChange={(e) => setColMapping(prev => ({...prev, sku: e.target.value}))}
                                >
                                    <option value="">-- 请选择列 --</option>
                                    {renderColumnOptions(currentMappingFile.rawData[currentMappingFile.guessedHeaderIndex] || [])}
                                </select>
                           </div>

                           <div className="col-span-full md:col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">尺码 (Size)</label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    value={colMapping.size}
                                    onChange={(e) => setColMapping(prev => ({...prev, size: e.target.value}))}
                                >
                                    <option value="">-- 未包含 --</option>
                                    {renderColumnOptions(currentMappingFile.rawData[currentMappingFile.guessedHeaderIndex] || [])}
                                </select>
                           </div>

                           <div className="col-span-full md:col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    {selectedType === DataType.MARKET ? '价格 (Price) *' : '牌价 / 原价 (Tag Price)'}
                                </label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    value={colMapping.price}
                                    onChange={(e) => setColMapping(prev => ({...prev, price: e.target.value}))}
                                >
                                    <option value="">-- 未包含 --</option>
                                    {renderColumnOptions(currentMappingFile.rawData[currentMappingFile.guessedHeaderIndex] || [])}
                                </select>
                           </div>

                           <div className="col-span-full md:col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    {selectedType === DataType.MARKET ? '市场忽略折扣' : '折扣 (Discount)'}
                                </label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    value={colMapping.discount}
                                    onChange={(e) => setColMapping(prev => ({...prev, discount: e.target.value}))}
                                >
                                    <option value="">-- 未包含 (默认无折扣) --</option>
                                    {renderColumnOptions(currentMappingFile.rawData[currentMappingFile.guessedHeaderIndex] || [])}
                                </select>
                           </div>
                           
                            <div className="col-span-full md:col-span-1">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    销量 (Sales)
                                    {(selectedType === DataType.INVENTORY || selectedType === DataType.FUTURE) && ' *'}
                                </label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    value={colMapping.sales}
                                    onChange={(e) => setColMapping(prev => ({...prev, sales: e.target.value}))}
                                >
                                    <option value="">-- 未包含 --</option>
                                    {renderColumnOptions(currentMappingFile.rawData[currentMappingFile.guessedHeaderIndex] || [])}
                                </select>
                           </div>

                           <div className="col-span-full flex items-center gap-2 mt-2 pt-4 border-t border-blue-200">
                                <input 
                                    type="checkbox" 
                                    id="rememberMapping"
                                    checked={rememberMapping}
                                    onChange={(e) => setRememberMapping(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <label htmlFor="rememberMapping" className="text-sm text-gray-700 flex items-center gap-1 cursor-pointer">
                                    <Bookmark size={14} className="text-blue-500"/>
                                    记住此表头映射规则 (下次遇到相同表头自动应用)
                                </label>
                           </div>
                      </div>
                  </div>

                  <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-between">
                      <button 
                        onClick={handleSkipFile}
                        className="text-gray-500 hover:text-gray-700 px-4 py-2 font-medium transition"
                      >
                          跳过此文件
                      </button>
                      <button 
                        onClick={handleConfirmMapping}
                        disabled={!colMapping.sku}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-blue-200 transition"
                      >
                          <Check size={18} />
                          确认并导入
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Data Preview (Last 50) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-semibold text-gray-700">最新数据预览 (Top 50)</h3>
              <span className="text-xs text-gray-400">总条数: {data.length}</span>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                      <tr>
                          <th className="px-4 py-3">上传平台</th>
                          <th className="px-4 py-3">上传表名称 & 日期</th>
                          <th className="px-4 py-3">类型</th>
                          <th className="px-4 py-3">货号 (SKU)</th>
                          <th className="px-4 py-3">价格</th>
                          <th className="px-4 py-3">折扣</th>
                          <th className="px-4 py-3">销量</th>
                      </tr>
                  </thead>
                  <tbody>
                      {data.slice(-50).reverse().map((row) => (
                          <tr key={row.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium text-gray-900">{row.platform}</td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col">
                                    <span className="text-xs font-medium text-gray-700 truncate max-w-[150px]" title={row.sourceFile}>{row.sourceFile || '-'}</span>
                                    <span className="text-[10px] text-gray-400">{row.updateDate}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                    row.dataType === DataType.MARKET ? 'bg-green-100 text-green-800' :
                                    row.dataType === DataType.SUPPLIER ? 'bg-blue-100 text-blue-800' :
                                    'bg-gray-100 text-gray-800'
                                }`}>
                                    {getShortDataTypeLabel(row.dataType)}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono">{row.productCode}</td>
                              <td className="px-4 py-3">{row.price > 0 ? `¥${row.price}` : '-'}</td>
                              <td className="px-4 py-3">{row.discount < 10 ? `${row.discount}折` : '-'}</td>
                              <td className="px-4 py-3">{row.salesRaw}</td>
                          </tr>
                      ))}
                      {data.length === 0 && (
                          <tr>
                              <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无数据</td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};

export default DataManager;