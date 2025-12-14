import React, { useState, useEffect } from 'react';
import { ShoeRecord, DataType } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';

interface DashboardProps {
  data: ShoeRecord[];
}

const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  // Logic: Calculate totals
  const inventoryItems = data.filter(d => d.dataType === DataType.INVENTORY);
  const futureItems = data.filter(d => d.dataType === DataType.FUTURE);
  
  const totalInventory = inventoryItems.reduce((acc, curr) => acc + curr.salesNum, 0);
  const totalFuture = futureItems.reduce((acc, curr) => acc + curr.salesNum, 0);

  const pieData = [
    { name: '自有库存', value: totalInventory },
    { name: '期货订单', value: totalFuture },
  ];

  const COLORS = ['#3b82f6', '#8b5cf6'];

  // Top Platforms by Record Count
  const platformCounts: Record<string, number> = {};
  data.forEach(d => {
    platformCounts[d.platform] = (platformCounts[d.platform] || 0) + 1;
  });
  
  const barData = Object.keys(platformCounts).map(key => ({
    name: key,
    count: platformCounts[key]
  })).sort((a, b) => b.count - a.count);

  return (
    <div className="p-8 space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">资产看板</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">总数据条目</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{data.length.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">自有库存总量</p>
          <p className="text-3xl font-bold text-blue-600 mt-2">{totalInventory.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">在途/期货总量</p>
          <p className="text-3xl font-bold text-purple-600 mt-2">{totalFuture.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <p className="text-sm text-gray-500 font-medium">系统状态</p>
            <div className="flex items-center gap-2 mt-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-sm text-gray-700">运行中</span>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Inventory Composition */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-96">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">库存构成</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                fill="#8884d8"
                paddingAngle={5}
                dataKey="value"
                label
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Platform Distribution */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-96">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">平台数据分布</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
              <Tooltip cursor={{fill: 'transparent'}} />
              <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;