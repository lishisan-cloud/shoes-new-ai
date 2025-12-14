import { GoogleGenAI, Chat } from "@google/genai";
import { ArbitrageResult } from '../types';

// Initialize Gemini Client
// @ts-ignore - process.env is handled by the build system
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// System instruction for the AI Agent
const SYSTEM_INSTRUCTION = `
角色设定：你是一位拥有 10 年经验的球鞋市场数据分析师和套利专家 (Sneaker Arbitrage Expert)。
任务：基于用户上传的套利分析数据，提供专业的市场分析、风险评估和补货建议。

核心分析维度：
1. **流动性陷阱 (Liquidity Trap)**：重点识别“高利润 (Profit > ¥100) 但 低销量 (Sales < 5)”的鞋款。这是主要风险点，务必提示用户谨慎囤货，避免资金占用。
2. **黄金补货款 (Gold Restock)**：筛选“中高利润 + 高销量 (Sales > 50)”的爆款，建议用户重点采购，以此作为现金流来源。
3. **资金效率 (Capital Efficiency)**：关注 ROI 高且周转快的款式。

回复规范：
- 语言：简体中文。
- 风格：专业、客观、直击痛点。拒绝废话。
- 格式：使用 Markdown (如 **加粗重点**、列表、表格) 增强可读性。
- 严谨性：严格基于提供的 Context 数据回答。若数据中没有某款鞋，直接告知“数据中未找到该SKU”。
`;

export const createDataAnalysisChat = (topOpportunities: ArbitrageResult[]): Chat => {
  if (!process.env.API_KEY) {
    console.warn("未检测到 API Key，AI 分析功能可能不可用");
  }

  // Create a context summary for the AI
  // Limit to top 200 items to balance context window usage and data coverage
  const dataContext = topOpportunities.slice(0, 200).map((item, index) => 
    `Rank #${index + 1} | SKU: ${item.productCode} | 成本: ¥${item.costPrice.toFixed(0)} | 市价: ¥${item.marketPrice.toFixed(0)} | 利润: ¥${item.profit.toFixed(0)} | ROI: ${(item.roi * 100).toFixed(1)}% | 平台销量: ${item.salesVolume} | 货源: ${item.supplierName}`
  ).join('\n');

  const chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7, 
    },
    history: [
      {
        role: 'user',
        parts: [{ text: `这是当前计算出的 Top 200 套利机会数据（已按利润排序）：\n\n${dataContext}\n\n请准备好基于这些数据回答我的分析问题。` }],
      },
      {
        role: 'model',
        parts: [{ text: "收到。数据已加载完毕。作为您的智能操盘手，我可以为您识别**流动性陷阱**、推荐**最佳补货清单**或分析**特定SKU的市场表现**。请告诉我您想了解什么？" }],
      }
    ]
  });

  return chat;
};