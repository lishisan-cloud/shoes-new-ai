import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, BrainCircuit, Loader2, Send, Bot, User, AlertTriangle, Database, FileText } from 'lucide-react';
import { ShoeRecord, DataType, ArbitrageResult, SalesHistoryItem } from '../types';
import { readExcelFile, findHeaderRow, cleanProductCode, exportToCSV, extractSalesNum, parseDiscount } from '../utils';
import { createDataAnalysisChat } from '../services/geminiService';
import { Chat } from '@google/genai';

interface ArbitrageAnalyzerProps {
  masterData: ShoeRecord[];
}

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

const ArbitrageAnalyzer: React.FC<ArbitrageAnalyzerProps> = ({ masterData }) => {
  const [results, setResults] = useState<ArbitrageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Stats
  const marketDataCount = masterData.filter(d => d.dataType === DataType.MARKET).length;
  const supplierDataCount = masterData.filter(d => d.dataType === DataType.SUPPLIER).length;

  // Chat State
  const [chatInstance, setChatInstance] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const processArbitrage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setErrorMsg(null);
    setChatHistory([]);
    setChatInstance(null);
    setResults([]);

    try {
      const rawData = await readExcelFile(file);
      if (!rawData || rawData.length === 0) {
        throw new Error("文件内容为空");
      }

      const headerRowIndex = findHeaderRow(rawData);
      const headerRow = rawData[headerRowIndex].map((c: any) => String(c).trim());

      let skuIdx = -1;
      let tagPriceIdx = -1;
      let discountIdx = -1;
      let salesIdx = -1;

      // Expanded keyword matching for column detection
      headerRow.forEach((col: string, idx: number) => {
        // SKU
        if (['货号', 'SKU', '款号', 'Product Code', 'Art No'].some(k => col.includes(k))) skuIdx = idx;
        // Tag Price
        if (['牌价', '原价', 'Tag Price', 'MSRP', '发售价'].some(k => col.includes(k))) tagPriceIdx = idx;
        // Discount (Optional - from Upload)
        if (['折扣', 'Discount', '下单折扣'].some(k => col.includes(k))) discountIdx = idx;
        // Sales (Optional - from Upload)
        if (['销量', 'Sales', '累计销量', '近30天销量', '热度', '平台销量'].some(k => col.includes(k))) salesIdx = idx;
      });

      if (skuIdx === -1 || tagPriceIdx === -1) {
        setErrorMsg("无法识别表头。请确保表格包含“货号(SKU)”和“牌价/原价”列。");
        setLoading(false);
        return;
      }

      const calculated: ArbitrageResult[] = [];
      let matchCount = 0;
      const todayDate = new Date().toISOString().split('T')[0];

      // Use a Map to deduplicate SKUs from the upload file if desired, 
      // but usually we process line by line. 
      // User requested "SKU only show one", implying we should group results by SKU.
      // We will aggregate rows from the upload if they are identical SKUs.
      const skuMap = new Map<string, ArbitrageResult>();

      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || !row[skuIdx]) continue;

        const sku = cleanProductCode(row[skuIdx]);
        if (!sku) continue; // Skip empty rows

        const tagPrice = parseFloat(row[tagPriceIdx]) || 0;

        // 1. Get Market Price (Dewu) from Database
        const marketMatches = masterData.filter(d => d.productCode === sku && d.dataType === DataType.MARKET);
        const marketPrice = marketMatches.length > 0 ? marketMatches[0].price : 0;
        
        // 2. Inventory / Future counts
        const invCount = masterData
          .filter(d => d.productCode === sku && d.dataType === DataType.INVENTORY)
          .reduce((sum, r) => sum + r.salesNum, 0);

        const futureCount = masterData
          .filter(d => d.productCode === sku && d.dataType === DataType.FUTURE)
          .reduce((sum, r) => sum + r.salesNum, 0);

        // 3. Determine Mode: Supplier File (Scenario A) OR Buying List (Scenario B)
        const hasUploadSales = salesIdx !== -1 && row[salesIdx] !== undefined && String(row[salesIdx]).trim() !== '';
        const hasUploadDiscount = discountIdx !== -1 && row[discountIdx] !== undefined;
        
        // Determine Discount to use for Profit Calculation
        // If upload has discount, use it. Otherwise default to 10 (no discount).
        const effectiveDiscount = hasUploadDiscount ? parseDiscount(row[discountIdx]) : 10;
        
        // Financials
        const costPrice = tagPrice * (effectiveDiscount / 10);
        const netRevenue = marketPrice > 0 ? marketPrice * 0.88 : 0; 
        const profit = marketPrice > 0 ? (netRevenue - costPrice) : -costPrice; 
        const roi = (costPrice > 0 && marketPrice > 0) ? (profit / costPrice) : 0;

        if (marketPrice > 0) matchCount++;

        // 4. Sales History Logic
        let salesHistory: SalesHistoryItem[] = [];
        let displaySales = 0;

        if (hasUploadSales) {
            // SCENARIO A: Upload has sales data -> Treat as single source
            const uploadSales = extractSalesNum(row[salesIdx]);
            displaySales = uploadSales;
            salesHistory.push({
                date: todayDate,
                file: file.name,
                sales: uploadSales,
                platform: '本次导入'
            });
        } else {
            // SCENARIO B: Buying List -> Look up DB matches
            // Broaden search to include both Supplier and Market data with valid sales
            const historyMatches = masterData.filter(d => 
                d.productCode === sku && 
                d.salesNum > 0 && 
                (d.dataType === DataType.SUPPLIER || d.dataType === DataType.MARKET)
            );
            
            if (historyMatches.length > 0) {
                // Deduplicate history by (File + Date + Platform)
                // If multiple records exist for the same file (e.g. size-specific rows), take the max salesNum found.
                const uniqueHistoryMap = new Map<string, SalesHistoryItem>();

                historyMatches.forEach(m => {
                    const key = `${m.updateDate}#${m.sourceFile || 'Unknown'}#${m.platform}`;
                    const existing = uniqueHistoryMap.get(key);
                    if (!existing || m.salesNum > existing.sales) {
                        uniqueHistoryMap.set(key, {
                            date: m.updateDate,
                            file: m.sourceFile || 'Unknown',
                            sales: m.salesNum,
                            platform: m.platform
                        });
                    }
                });

                salesHistory = Array.from(uniqueHistoryMap.values());

                // Sort history by date descending
                salesHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                // Set display sales to the max found (or latest)
                displaySales = Math.max(...salesHistory.map(h => h.sales));
            } else {
                 // No match
                 displaySales = 0;
            }
        }

        const result: ArbitrageResult = {
            productCode: sku,
            tagPrice,
            costPrice,
            marketPrice,
            netRevenue,
            profit,
            roi,
            supplierName: hasUploadSales ? '本次导入' : '历史匹配',
            supplierDate: todayDate,
            supplierSourceFile: file.name, // The OPPORTUNITY source file
            salesVolume: displaySales,
            salesHistory: salesHistory,
            inventoryCount: invCount,
            futureCount: futureCount
        };

        // Group by SKU
        if (!skuMap.has(sku)) {
            skuMap.set(sku, result);
        } else {
            const existing = skuMap.get(sku)!;
            if (result.profit > existing.profit) {
                skuMap.set(sku, result);
            }
        }
      }

      if (skuMap.size === 0) {
        setErrorMsg("未在文件中找到有效的数据行。");
      } else {
        const finalResults = Array.from(skuMap.values());
        // Sort by Profit High to Low
        finalResults.sort((a, b) => b.profit - a.profit);
        setResults(finalResults);
        
        if (matchCount > 0) {
            try {
                const chat = createDataAnalysisChat(finalResults);
                setChatInstance(chat);
                setChatHistory([{ role: 'model', text: `分析完成！已为您合并同款商品，共生成 ${finalResults.length} 条唯一 SKU 数据。我是您的 AI 操盘手，请问需要我分析什么？` }]);
            } catch (e: any) {
                console.error("AI Init Failed", e);
                setChatHistory([{ role: 'model', text: `AI 初始化失败: ${e.message || '未知错误'}。` }]);
            }
        } else {
             setChatHistory([{ role: 'model', text: `数据已导入，但**未匹配到任何市场价格**。请先在“数据中心”上传得物/Nice的价格数据。` }]);
        }
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(`处理失败: ${err.message || "未知错误"}`);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !chatInstance) return;
    
    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatting(true);

    try {
        const response = await chatInstance.sendMessage({ message: userMsg });
        const text = response.text || "无回复";
        setChatHistory(prev => [...prev, { role: 'model', text }]);
    } catch (e) {
        setChatHistory(prev => [...prev, { role: 'model', text: "AI 响应错误，请重试。" }]);
    } finally {
        setIsChatting(false);
    }
  };

  const handleExportChat = () => {
    if (chatHistory.length === 0) return;

    const content = chatHistory.map(msg => {
        const role = msg.role === 'user' ? '我的提问' : 'AI 分析报告';
        return `### ${role}\n\n${msg.text}\n`;
    }).join('\n---\n\n');

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AI_市场分析报告_${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadCSV = () => {
    if (results.length === 0) return;

    // 1. Identify all unique History Keys (Date + Platform + File) to create dynamic columns
    const dynamicKeys = new Set<string>();
    results.forEach(r => {
        r.salesHistory?.forEach(h => {
            // Use a unique separator to composite key
            const key = `${h.date}#${h.platform}#${h.file}`;
            dynamicKeys.add(key);
        });
    });

    // Sort keys: Chronological (Ascending: Old -> New)
    const sortedKeys = Array.from(dynamicKeys).sort((a, b) => {
        const dateA = a.split('#')[0];
        const dateB = b.split('#')[0];
        // Ascending sort for time series left-to-right
        return dateA.localeCompare(dateB);
    });

    // 2. Build Rows
    const exportData = results.map(r => {
        const baseRow: any = {
            "货号(SKU)": r.productCode,
            "牌价": r.tagPrice,
            "进货折扣": (r.costPrice > 0 && r.tagPrice > 0) ? (r.costPrice / r.tagPrice * 10).toFixed(2) : '10.00',
            "进货价(Cost)": r.costPrice.toFixed(2),
            "得物市价(Market)": r.marketPrice || '未匹配',
            "预计到手价": r.netRevenue.toFixed(2),
            "预计利润(Profit)": r.profit.toFixed(2),
            "投资回报率(ROI)": (r.roi * 100).toFixed(2) + '%',
            // "推荐数据来源" helps distinguish the source of the DISCOUNT/PRICE used for calculation
            "计算来源": r.supplierName, 
            "计算源文件": r.supplierSourceFile,
            "自有库存": r.inventoryCount,
            "期货订单": r.futureCount
        };

        // Fill Dynamic Columns for Sales History
        sortedKeys.forEach(key => {
             const [kDate, kPlatform, kFile] = key.split('#');
             const match = r.salesHistory?.find(h => h.date === kDate && h.platform === kPlatform && h.file === kFile);
             
             // Format Header Logic:
             // Req: Show platform and filename (which implies date).
             // Format: "Platform-Filename" (e.g. 天马-2025-08-20.xlsx)
             let headerName = '';
             if (kPlatform === '本次导入') {
                 headerName = `本次导入销量 [${kFile}]`;
             } else {
                 // Combine Platform and Filename to clearly distinguish sources
                 headerName = `${kPlatform}-${kFile}`;
             }

             baseRow[headerName] = match ? match.sales : '';
        });

        return baseRow;
    });
    
    exportToCSV(exportData, `套利分析报表_透视_${new Date().toISOString().split('T')[0]}`);
  };

  return (
    <div className="p-8 space-y-6 h-full flex flex-col">
      {/* Header Area */}
      <div className="flex justify-between items-start">
        <div>
            <h2 className="text-2xl font-bold text-gray-800">智能操盘匹配</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <span className="flex items-center gap-1"><Database size={14} /> 数据库状态:</span>
                <span className={`${marketDataCount > 0 ? 'text-green-600' : 'text-red-500 font-bold'}`}>
                    市场价数据: {marketDataCount} 条
                </span>
                <span className="w-px h-3 bg-gray-300"></span>
                <span className={`${supplierDataCount > 0 ? 'text-blue-600' : 'text-orange-500'}`}>
                    供应商数据: {supplierDataCount} 条
                </span>
            </div>
        </div>
        <div className="flex gap-3">
             <button 
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition shadow-sm disabled:opacity-50"
             >
                {loading ? <Loader2 className="animate-spin" size={18}/> : <Upload size={18} />}
                上传采购单
             </button>
             <input type="file" ref={fileRef} className="hidden" accept=".xlsx,.xls,.csv" onChange={processArbitrage} />
             
             {results.length > 0 && (
                <button 
                    onClick={downloadCSV}
                    className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg transition"
                >
                    <Download size={18} />
                    导出报表 (透视表)
                </button>
             )}
        </div>
      </div>

      {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
              <AlertTriangle size={20} />
              <span>{errorMsg}</span>
          </div>
      )}

      {/* Database Warning */}
      {marketDataCount === 0 && !errorMsg && results.length === 0 && (
           <div className="bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-lg flex items-center gap-2">
              <AlertTriangle size={20} />
              <span>注意：检测到“数据中心”没有市场价格数据。请先在数据中心上传【得物/Nice】的价格表，否则无法计算利润。</span>
          </div>
      )}

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Left: Data Table */}
        <div className={`flex-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col ${results.length > 0 ? 'w-2/3' : 'w-full'}`}>
            <div className="overflow-x-auto overflow-y-auto flex-1">
                <table className="w-full text-sm text-left relative">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b sticky top-0 z-10">
                        <tr>
                            <th className="px-4 py-3">SKU</th>
                            <th className="px-4 py-3">牌价</th>
                            <th className="px-4 py-3">折扣(进)</th>
                            <th className="px-4 py-3">得物(出)</th>
                            <th className="px-4 py-3 font-bold text-blue-600">预计利润</th>
                            <th className="px-4 py-3">ROI</th>
                            <th className="px-4 py-3">平台销量(历史)</th>
                            <th className="px-4 py-3">推荐来源</th>
                            <th className="px-4 py-3">库存</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {results.length === 0 && (
                            <tr><td colSpan={9} className="text-center py-20 text-gray-400">请上传采购清单进行计算</td></tr>
                        )}
                        {results.map((r, idx) => {
                            // Highlight logic
                            const isProfitable = r.profit > 50;
                            const hasInventory = r.inventoryCount > 0;
                            const missingMarket = r.marketPrice === 0;
                            
                            let bgClass = '';
                            if (hasInventory) bgClass = 'bg-blue-50/50';
                            else if (missingMarket) bgClass = 'bg-gray-50'; // Dimmed
                            else if (isProfitable) bgClass = 'bg-green-50/30';

                            return (
                                <tr key={`${r.productCode}-${idx}`} className={`hover:bg-gray-50 ${bgClass}`}>
                                    <td className="px-4 py-3 font-medium font-mono">{r.productCode}</td>
                                    <td className="px-4 py-3 text-gray-500">¥{r.tagPrice}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col">
                                            <span className="text-xs text-gray-500">¥{r.costPrice.toFixed(0)}</span>
                                            <span className="text-[10px] text-gray-400">进: {(r.costPrice > 0 ? r.costPrice / r.tagPrice * 10 : 10).toFixed(1)}折</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {r.marketPrice > 0 ? (
                                            <div className="flex flex-col">
                                                <span className="text-xs">¥{r.marketPrice}</span>
                                                <span className="text-[10px] text-gray-400">到手: ¥{r.netRevenue.toFixed(0)}</span>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-orange-400">无数据</span>
                                        )}
                                    </td>
                                    <td className={`px-4 py-3 font-bold ${r.marketPrice === 0 ? 'text-gray-300' : (r.profit > 0 ? 'text-green-600' : 'text-red-500')}`}>
                                        {r.marketPrice > 0 ? `¥${r.profit.toFixed(1)}` : '-'}
                                    </td>
                                    <td className="px-4 py-3">
                                        {r.marketPrice > 0 ? (
                                            <span className={`px-2 py-0.5 rounded text-xs ${r.roi > 0.2 ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                                                {(r.roi * 100).toFixed(1)}%
                                            </span>
                                        ) : '-'}
                                    </td>
                                    <td className="px-4 py-3">
                                        {/* Summarized Sales History in UI */}
                                        {r.salesHistory && r.salesHistory.length > 0 ? (
                                            <div className="flex flex-col gap-1 max-h-[60px] overflow-y-auto custom-scrollbar">
                                                {r.salesHistory.map((h, hidx) => (
                                                    <div key={hidx} className="text-xs flex justify-between gap-4 text-gray-600 border-b border-gray-100 last:border-0 pb-0.5">
                                                        <span className="scale-90 origin-left text-gray-500">{h.platform} {h.date.substring(5)}</span>
                                                        <span className="font-mono font-medium">{h.sales}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col max-w-[120px]">
                                            <span className="text-xs text-gray-600 truncate">{r.supplierName}</span>
                                            <span className="text-[10px] text-gray-400 truncate" title={r.supplierSourceFile}>{r.supplierSourceFile}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {r.inventoryCount > 0 && <span className="text-blue-600 font-bold">{r.inventoryCount}</span>}
                                        {r.futureCount > 0 && <span className="text-purple-600 ml-2">+{r.futureCount}</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Right: AI Chat Panel */}
        {results.length > 0 && (
            <div className="w-96 flex flex-col bg-white rounded-xl shadow-lg border border-indigo-100 overflow-hidden shrink-0">
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 text-white flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <BrainCircuit size={20} />
                        <span className="font-semibold">AI 操盘手 Agent</span>
                    </div>
                    {chatHistory.length > 0 && (
                        <button 
                            onClick={handleExportChat}
                            title="导出分析报告"
                            className="p-1 hover:bg-white/20 rounded transition"
                        >
                            <FileText size={18} />
                        </button>
                    )}
                </div>
                
                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                    {chatHistory.map((msg, i) => (
                        <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-purple-100 text-purple-600'}`}>
                                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                            </div>
                            <div className={`p-3 rounded-lg text-sm max-w-[80%] ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 shadow-sm text-gray-700'}`}>
                                {msg.text.split('\n').map((line, idx) => <p key={idx} className="mb-1">{line}</p>)}
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-gray-100">
                    <div className="flex gap-2">
                        <input 
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder={isChatting ? "AI 正在思考..." : "询问 AI 风险分析或补货建议..."}
                            disabled={isChatting}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <button 
                            onClick={handleSendMessage}
                            disabled={isChatting || !chatInput.trim()}
                            className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                            {isChatting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default ArbitrageAnalyzer;