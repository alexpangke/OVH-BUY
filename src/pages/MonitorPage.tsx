import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/utils/apiClient';
import { toast } from 'sonner';
import { Bell, BellOff, Plus, Trash2, Settings, RefreshCw, History, ChevronUp } from 'lucide-react';
import { useAPI } from '@/context/APIContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/components/ToastContainer';

interface Subscription {
  planCode: string;
  serverName?: string;  // 服务器友好名称
  datacenters: string[];
  notifyAvailable: boolean;
  notifyUnavailable: boolean;
  autoOrder?: boolean;
  quantity?: number;  // 自动下单数量
  lastStatus: Record<string, string>;
  createdAt: string;
}

interface MonitorStatus {
  running: boolean;
  subscriptions_count: number;
  known_servers_count: number;
  check_interval: number;
}

interface HistoryEntry {
  timestamp: string;
  datacenter: string;
  status: string;
  changeType: string;
  oldStatus: string | null;
  config?: {
    memory: string;
    storage: string;
    display: string;
  };
}

const MonitorPage = () => {
  const isMobile = useIsMobile();
  const { isAuthenticated } = useAPI();
  const { showConfirm } = useToast();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    running: false,
    subscriptions_count: 0,
    known_servers_count: 0,
    check_interval: 5
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, HistoryEntry[]>>({});
  const prevSubscriptionsRef = useRef<Subscription[]>([]);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 添加订阅表单
  const [formData, setFormData] = useState({
    planCode: '',
    datacenters: '',
    notifyAvailable: true,
    notifyUnavailable: false,
    autoOrder: false,
    quantity: 1  // 自动下单数量，默认为1
  });

  // 加载订阅列表
  const loadSubscriptions = async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      // 延迟显示加载状态，避免快速加载时的闪烁
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoading(true);
      }, 150);
    }
    try {
      const response = await api.get('/monitor/subscriptions');
      const newData = response.data as Subscription[];

      // ✅ 统一自动下单逻辑：仅后端监控负责自动下单，前端只负责状态显示
      // 后端监控器在检测到状态变化时会自动触发下单（如果订阅启用了autoOrder）
      // 前端移除自动下单逻辑，避免与后端重复下单

      setSubscriptions(newData);
      prevSubscriptionsRef.current = newData;
      // 如果数据加载完成，清除延迟显示的加载状态
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setIsLoading(false);
    } catch (error) {
      console.error('加载订阅失败:', error);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      if (!isRefresh) {
        toast.error('加载订阅失败');
      }
      setIsLoading(false);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 加载监控状态
  const loadMonitorStatus = async () => {
    try {
      const response = await api.get('/monitor/status');
      setMonitorStatus(response.data);
    } catch (error) {
      console.error('加载监控状态失败:', error);
    }
  };

  // 添加订阅
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.planCode.trim()) {
      toast.error('请输入服务器型号');
      return;
    }
    
    try {
      const datacenters = formData.datacenters
        .split(',')
        .map(dc => dc.trim())
        .filter(dc => dc);
      
      await api.post('/monitor/subscriptions', {
        planCode: formData.planCode.trim(),
        datacenters: datacenters.length > 0 ? datacenters : [],
        notifyAvailable: formData.notifyAvailable,
        notifyUnavailable: formData.notifyUnavailable,
        autoOrder: formData.autoOrder,
        quantity: formData.autoOrder ? (formData.quantity || 1) : undefined
      });
      
      toast.success(`已订阅 ${formData.planCode}`);
      setFormData({
        planCode: '',
        datacenters: '',
        notifyAvailable: true,
        notifyUnavailable: false,
        autoOrder: false,
        quantity: 1
      });
      setShowAddForm(false);
      loadSubscriptions(true);
      loadMonitorStatus();
    } catch (error) {
      toast.error('订阅失败');
    }
  };

  // 删除订阅
  const handleRemoveSubscription = async (planCode: string) => {
    const confirmed = await showConfirm({
      title: '取消订阅',
      message: `确定要取消订阅 ${planCode} 吗？`,
      confirmText: '确定',
      cancelText: '取消'
    });
    
    if (!confirmed) {
      return;
    }
    
    try {
      await api.delete(`/monitor/subscriptions/${planCode}`);
      toast.success(`已取消订阅 ${planCode}`);
      loadSubscriptions(true);
      loadMonitorStatus();
    } catch (error) {
      toast.error('取消订阅失败');
    }
  };

  // 清空所有订阅
  const handleClearAll = async () => {
    const confirmed = await showConfirm({
      title: '清空所有订阅',
      message: '确定要清空所有订阅吗？此操作不可撤销。',
      confirmText: '确定清空',
      cancelText: '取消'
    });
    
    if (!confirmed) {
      return;
    }
    
    try {
      const response = await api.delete('/monitor/subscriptions/clear');
      toast.success(`已清空 ${response.data.count} 个订阅`);
      loadSubscriptions(true);
      loadMonitorStatus();
    } catch (error) {
      toast.error('清空订阅失败');
    }
  };

  // 获取订阅历史记录
  const loadHistory = async (planCode: string) => {
    try {
      const response = await api.get(`/monitor/subscriptions/${planCode}/history`);
      setHistoryData(prev => ({
        ...prev,
        [planCode]: response.data.history
      }));
    } catch (error) {
      toast.error('加载历史记录失败');
    }
  };

  // 切换历史记录展开/收起
  const toggleHistory = async (planCode: string) => {
    if (expandedHistory === planCode) {
      setExpandedHistory(null);
    } else {
      setExpandedHistory(planCode);
      if (!historyData[planCode]) {
        await loadHistory(planCode);
      }
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadSubscriptions();
      loadMonitorStatus();
      
      // 定时刷新状态
      const interval = setInterval(() => {
        loadMonitorStatus();
      }, 30000); // 30秒刷新一次
      
      return () => {
        clearInterval(interval);
        // 清理延迟加载的定时器
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
      };
    }
    // ✅ 添加依赖项：loadSubscriptions 和 loadMonitorStatus 是稳定的函数引用，不会导致无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold mb-1 cyber-glow-text`}>服务器监控</h1>
        <p className="text-cyber-muted text-sm mb-4 sm:mb-6">自动监控服务器可用性变化并推送通知</p>
      </motion.div>

      {/* 监控状态卡片 */}
      <div className="cyber-panel p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-3 sm:gap-0 mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            {monitorStatus.running ? (
              <div className="p-1.5 sm:p-2 bg-green-500/20 rounded">
                <Bell className="text-green-400" size={isMobile ? 20 : 24} />
              </div>
            ) : (
              <div className="p-1.5 sm:p-2 bg-gray-500/20 rounded">
                <BellOff className="text-gray-400" size={isMobile ? 20 : 24} />
              </div>
            )}
            <div>
              <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold`}>监控状态</h3>
              <p className="text-xs sm:text-sm text-cyber-muted">
                {monitorStatus.running ? (
                  <span className="text-green-400">● 运行中</span>
                ) : (
                  <span className="text-gray-400">● 已停止</span>
                )}
              </p>
            </div>
          </div>
          
          <button
            onClick={() => {
              loadSubscriptions(true);
              loadMonitorStatus();
            }}
            disabled={isRefreshing}
            className="cyber-button text-xs sm:text-sm flex items-center gap-2"
          >
            <RefreshCw size={isMobile ? 14 : 16} className={`flex-shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="min-w-[2.5rem]">刷新</span>
          </button>
        </div>

        {/* 统计信息 */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-cyber-grid/10 p-2 sm:p-3 rounded border border-cyber-accent/20">
            <p className="text-[10px] sm:text-xs text-cyber-muted mb-1">订阅数</p>
            <p className="text-lg sm:text-2xl font-bold text-cyber-accent">{monitorStatus.subscriptions_count}</p>
          </div>
          <div className="bg-cyber-grid/10 p-2 sm:p-3 rounded border border-cyber-accent/20">
            <p className="text-[10px] sm:text-xs text-cyber-muted mb-1">检查间隔</p>
            <p className="text-lg sm:text-2xl font-bold text-cyber-accent">{monitorStatus.check_interval}s</p>
          </div>
          <div className="bg-cyber-grid/10 p-2 sm:p-3 rounded border border-cyber-accent/20">
            <p className="text-[10px] sm:text-xs text-cyber-muted mb-1 truncate">已知服务器</p>
            <p className="text-lg sm:text-2xl font-bold text-cyber-accent">{monitorStatus.known_servers_count}</p>
          </div>
        </div>
      </div>

      {/* 订阅列表 */}
      <div className="cyber-panel p-4">
        <div className="flex justify-between items-center mb-4">
          <h4 className="font-semibold flex items-center gap-2">
            <Settings size={18} />
            订阅列表
          </h4>
          <div className="flex gap-2">
            {subscriptions.length > 0 && (
              <button
                onClick={handleClearAll}
                className="cyber-button text-sm flex items-center gap-1.5 bg-red-900/30 border-red-700/40 text-red-300 hover:bg-red-800/40 hover:border-red-600/50 hover:text-red-200"
              >
                <Trash2 size={14} />
                清空全部
              </button>
            )}
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="cyber-button text-sm flex items-center gap-1.5 bg-cyber-accent/20 border-cyber-accent/40 text-cyber-accent hover:bg-cyber-accent/30 hover:border-cyber-accent/60 hover:text-cyber-accent"
            >
              <Plus size={14} />
              添加订阅
            </button>
          </div>
        </div>

        {/* 添加订阅表单 */}
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-4 p-4 bg-cyber-grid/10 rounded border border-cyber-accent/20"
          >
            <form onSubmit={handleAddSubscription} className="space-y-3">
              <div>
                <label className="block text-sm text-cyber-muted mb-1">服务器型号 *</label>
                <input
                  type="text"
                  value={formData.planCode}
                  onChange={(e) => setFormData({...formData, planCode: e.target.value})}
                  placeholder="例如: 24ska01"
                  className="cyber-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-cyber-muted mb-1">
                  数据中心（可选，多个用逗号分隔）
                </label>
                <input
                  type="text"
                  value={formData.datacenters}
                  onChange={(e) => setFormData({...formData, datacenters: e.target.value})}
                  placeholder="例如: gra,rbx,sbg 或留空监控所有"
                  className="cyber-input w-full"
                />
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex gap-4 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.notifyAvailable}
                      onChange={(e) => setFormData({...formData, notifyAvailable: e.target.checked})}
                      className="cyber-checkbox"
                    />
                    <span className="text-sm">有货时提醒</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.notifyUnavailable}
                      onChange={(e) => setFormData({...formData, notifyUnavailable: e.target.checked})}
                      className="cyber-checkbox"
                    />
                    <span className="text-sm">无货时提醒</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.autoOrder}
                      onChange={(e) => setFormData({...formData, autoOrder: e.target.checked})}
                      className="cyber-checkbox"
                    />
                    <span className="text-sm">有货自动下单</span>
                  </label>
                </div>
                {formData.autoOrder && (
                  <div>
                    <label className="block text-sm text-cyber-muted mb-1">
                      下单数量
                      <span className="text-xs text-cyber-muted ml-2">
                        (检测出的配置数量 × 可用数据中心 × 数量 = 总下单量)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={String(formData.quantity || 1)}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || /^\d*$/.test(value)) {
                          const numValue = Number(value);
                          if (value === '' || (numValue > 0 && numValue <= 100)) {
                            setFormData({...formData, quantity: value === '' ? 1 : numValue});
                          }
                        }
                      }}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (isNaN(value) || value < 1) {
                          setFormData({...formData, quantity: 1});
                        } else if (value > 100) {
                          setFormData({...formData, quantity: 100});
                        } else {
                          setFormData({...formData, quantity: value});
                        }
                      }}
                      className="cyber-input w-full max-w-xs"
                      placeholder="默认: 1"
                    />
                    <p className="text-xs text-cyber-muted mt-1">
                      💡 例如：检测到2个配置，3个数据中心有货，数量填5，将创建 2×3×5=30 个订单
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button 
                  type="submit" 
                  className="cyber-button flex-1 px-4 py-2.5 bg-cyber-accent/20 border-cyber-accent/40 text-cyber-accent hover:bg-cyber-accent/30 hover:border-cyber-accent/60 hover:text-cyber-accent"
                >
                  确认添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="cyber-button flex-1 px-4 py-2.5"
                >
                  取消
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {/* 订阅列表 */}
        {(() => {
          // 在加载期间，如果有之前的数据，显示之前的数据；否则显示当前数据
          const displaySubscriptions = (isLoading && prevSubscriptionsRef.current.length > 0) 
            ? prevSubscriptionsRef.current 
            : subscriptions;
          
          if (displaySubscriptions.length === 0) {
            return (
              <div className="text-center text-cyber-muted py-12">
                <Bell size={48} className="mx-auto mb-4 opacity-30" />
                <p>暂无订阅</p>
                <p className="text-sm mt-2">点击"添加订阅"按钮开始监控服务器</p>
              </div>
            );
          }
          
          return (
            <div className="space-y-3">
              {displaySubscriptions.map((sub) => (
              <motion.div
                key={sub.planCode}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-cyber-grid/10 rounded border border-cyber-accent/20 hover:border-cyber-accent/40 transition-colors overflow-hidden"
              >
                 <div className="flex justify-between items-start p-3">
                   <div className="flex-1">
                     <div className="flex items-center gap-2 mb-1">
                       <p className="font-medium text-cyber-accent">{sub.planCode}</p>
                       {sub.serverName && (
                         <span className="text-xs text-cyber-muted">
                           | {sub.serverName}
                         </span>
                       )}
                     </div>
                     <p className="text-xs text-cyber-muted">
                       {sub.datacenters.length > 0 
                         ? `监控数据中心: ${sub.datacenters.join(', ')}`
                         : '监控所有数据中心'}
                     </p>
                    <div className="flex gap-2 mt-2">
                      {sub.notifyAvailable && (
                        <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                          有货提醒
                        </span>
                      )}
                      {sub.notifyUnavailable && (
                        <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">
                          无货提醒
                        </span>
                      )}
                      {sub.autoOrder && (
                        <span className="text-xs px-2 py-0.5 bg-cyber-accent/20 text-cyber-accent rounded">
                          自动下单{sub.quantity && sub.quantity > 1 ? ` (数量: ${sub.quantity})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleHistory(sub.planCode)}
                      className="p-2 text-cyber-accent hover:bg-cyber-accent/10 rounded transition-colors"
                      title="查看历史记录"
                    >
                      {expandedHistory === sub.planCode ? <ChevronUp size={16} /> : <History size={16} />}
                    </button>
                    <button
                      onClick={() => handleRemoveSubscription(sub.planCode)}
                      className="p-2 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      title="删除订阅"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* 历史记录展开区域 */}
                {expandedHistory === sub.planCode && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-cyber-accent/20 bg-cyber-grid/5"
                  >
                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-3">
                        <History size={14} className="text-cyber-accent" />
                        <span className="text-sm font-medium text-cyber-accent">变化历史</span>
                      </div>
                      
                      {historyData[sub.planCode]?.length > 0 ? (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                          {historyData[sub.planCode].map((entry, index) => (
                            <div
                              key={index}
                              className="flex items-start gap-3 p-2 bg-cyber-grid/10 rounded text-xs"
                            >
                              <div className="flex-shrink-0 mt-1">
                                {entry.changeType === 'available' ? (
                                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                ) : (
                                  <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-cyber-accent">{entry.datacenter.toUpperCase()}</span>
                                  <span className={`px-1.5 py-0.5 rounded ${
                                    entry.changeType === 'available' 
                                      ? 'bg-green-500/20 text-green-400' 
                                      : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {entry.changeType === 'available' ? '有货' : '无货'}
                                  </span>
                                </div>
                                {entry.config && (
                                  <div className="text-xs text-cyber-muted mt-1">
                                    <span className="inline-block px-2 py-0.5 bg-cyber-accent/10 rounded mr-1">
                                      {entry.config.display}
                                    </span>
                                  </div>
                                )}
                                <p className="text-cyber-muted mt-1 text-xs">
                                  {(() => {
                                    // ✅ 统一时间格式，避免依赖浏览器时区设置
                                    const date = new Date(entry.timestamp);
                                    const year = date.getFullYear();
                                    const month = String(date.getMonth() + 1).padStart(2, '0');
                                    const day = String(date.getDate()).padStart(2, '0');
                                    const hours = String(date.getHours()).padStart(2, '0');
                                    const minutes = String(date.getMinutes()).padStart(2, '0');
                                    const seconds = String(date.getSeconds()).padStart(2, '0');
                                    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
                                  })()}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-cyber-muted text-center py-4">
                          暂无历史记录
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default MonitorPage;
