import { useState, useMemo } from "react";
import { PLAYERS, DEFAULT_BREAK_CONFIG, BreakConfig } from "@/lib/data";
import { computeSlotPricing } from "@/lib/engine";
import DashboardConfig from "@/components/DashboardConfig";
import PlayerTable from "@/components/PlayerTable";
import BreakerComparison from "@/components/BreakerComparison";
import TierReference from "@/components/TierReference";

const Index = () => {
  const [config, setConfig] = useState<BreakConfig>(DEFAULT_BREAK_CONFIG);
  const [activeTab, setActiveTab] = useState<'players' | 'comparison' | 'tiers'>('players');

  const pricing = useMemo(() => computeSlotPricing(PLAYERS, config), [config]);

  const tabs = [
    { id: 'players' as const, label: 'Player Slots', count: pricing.length },
    { id: 'comparison' as const, label: 'Breaker Compare', count: null },
    { id: 'tiers' as const, label: 'Tier Reference', count: null },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">CP</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">CardPulse</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Break Analysis Engine</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">2025-26 Topps Finest Basketball</p>
            <p className="text-[10px] text-primary font-mono">v1.0 Prototype</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Dashboard Config */}
        <DashboardConfig config={config} onChange={setConfig} />

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span className="ml-1.5 text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full font-mono">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'players' && <PlayerTable pricing={pricing} />}
        {activeTab === 'comparison' && <BreakerComparison pricing={pricing} />}
        {activeTab === 'tiers' && <TierReference />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-4">
        <p className="text-center text-[10px] text-muted-foreground uppercase tracking-widest">
          CardPulse · Town & Line · Data-Driven Break Intelligence
        </p>
      </footer>
    </div>
  );
};

export default Index;
