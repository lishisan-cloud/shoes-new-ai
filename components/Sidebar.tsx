import React, { useState } from 'react';
import { LayoutDashboard, Database, TrendingUp, Plus, Trash2, Box } from 'lucide-react';
import { Channel } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  channels: Channel[];
  addChannel: (name: string) => void;
  removeChannel: (name: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  setActiveTab, 
  channels, 
  addChannel, 
  removeChannel 
}) => {
  const [newChannelName, setNewChannelName] = useState('');

  const handleAdd = () => {
    if (newChannelName.trim()) {
      addChannel(newChannelName.trim());
      setNewChannelName('');
    }
  };

  const navItems = [
    { id: 'dashboard', label: '资产看板', icon: LayoutDashboard },
    { id: 'data', label: '数据中心', icon: Database },
    { id: 'arbitrage', label: '智能操盘', icon: TrendingUp },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0 shadow-xl z-20">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-2">
            <Box className="w-8 h-8 text-blue-400" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            球鞋智能系统
            </h1>
        </div>
        <p className="text-xs text-slate-400 mt-1">专业套利 ERP 系统</p>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
              activeTab === item.id 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' 
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </button>
        ))}

        <div className="mt-8 pt-6 border-t border-slate-700">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">
            渠道管理
          </h3>
          <ul className="space-y-2 mb-4 max-h-48 overflow-y-auto">
            {channels.map((channel) => (
              <li key={channel.name} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 group">
                <span className="text-sm text-slate-300">{channel.name}</span>
                {channel.isRemovable && (
                  <button 
                    onClick={() => removeChannel(channel.name)}
                    className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          
          <div className="flex gap-2 px-2">
            <input
              type="text"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="新增渠道"
              className="w-full bg-slate-800 border-none text-xs text-white rounded px-2 py-1.5 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <button 
              onClick={handleAdd}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1.5"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </nav>
      
      <div className="p-4 border-t border-slate-700 text-center">
        <p className="text-xs text-slate-500">v1.0.0 MacOS 优化版</p>
      </div>
    </div>
  );
};

export default Sidebar;