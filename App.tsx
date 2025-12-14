import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import DataManager from './components/DataManager';
import ArbitrageAnalyzer from './components/ArbitrageAnalyzer';
import { Channel, ShoeRecord } from './types';

// Default Channels as per requirement
const DEFAULT_CHANNELS: Channel[] = [
  { name: '天马', isRemovable: false },
  { name: '得物', isRemovable: false },
  { name: 'Nice', isRemovable: true },
  { name: '自有库存', isRemovable: false },
  { name: '阿迪期货', isRemovable: true },
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // "Database" state with robust error handling for deployment safety
  const [channels, setChannels] = useState<Channel[]>(() => {
    try {
      const saved = localStorage.getItem('erp_channels');
      return saved ? JSON.parse(saved) : DEFAULT_CHANNELS;
    } catch (e) {
      console.warn('Failed to parse channels from localStorage, using defaults.', e);
      return DEFAULT_CHANNELS;
    }
  });

  const [masterData, setMasterData] = useState<ShoeRecord[]>(() => {
    try {
      const saved = localStorage.getItem('erp_master_data');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to parse master data from localStorage, resetting db.', e);
      return [];
    }
  });

  // Persistence
  useEffect(() => {
    localStorage.setItem('erp_channels', JSON.stringify(channels));
  }, [channels]);

  useEffect(() => {
    localStorage.setItem('erp_master_data', JSON.stringify(masterData));
  }, [masterData]);

  // Channel Actions
  const addChannel = (name: string) => {
    if (!channels.some(c => c.name === name)) {
      setChannels([...channels, { name, isRemovable: true }]);
    }
  };

  const removeChannel = (name: string) => {
    setChannels(channels.filter(c => c.name !== name));
  };

  // View Routing
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard data={masterData} />;
      case 'data':
        return <DataManager data={masterData} setData={setMasterData} channels={channels} />;
      case 'arbitrage':
        return <ArbitrageAnalyzer masterData={masterData} />;
      default:
        return <Dashboard data={masterData} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab}
        channels={channels}
        addChannel={addChannel}
        removeChannel={removeChannel}
      />

      {/* Main Content Area */}
      <main className="ml-64 w-full h-screen overflow-y-auto">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;