export type TradeConfig = {
  asset: string;
  currency: string;
  strategy: 'Signal' | 'Fast' | 'Momentum' | 'Flash 5st';
  interval: string;
  walletType: 'real' | 'demo';
  bidAmountIdr: string;
  bidAmountUsd: string;
  bidAmountEur: string;
  bidAmount?: string;
  autoSwitchDemo: boolean;
  signalInput: string;
  martingale: string;
  maxMartingale: string;
  resetMartingale: string;
  stopLoss: string;
  stopProfitAfter: string;
  rsiPeriod: string;
  rsiOverbought: string;
  rsiOversold: string;
  fastEma: string;
  slowEma: string;
  smaPeriod: string;
  fastMacd: string;
  slowMacd: string;
  signalMacd: string;
};

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  asset: 'Z-CRY/IDX',
  currency: 'IDR',
  strategy: 'Signal',
  interval: '1',
  walletType: 'demo',
  bidAmountIdr: '14000',
  bidAmountUsd: '1',
  bidAmountEur: '1',
  autoSwitchDemo: true,
  signalInput: '',
  martingale: '130',
  maxMartingale: '1',
  resetMartingale: '2',
  stopLoss: '2',
  stopProfitAfter: '999999999',
  rsiPeriod: '14',
  rsiOverbought: '55',
  rsiOversold: '45',
  fastEma: '5',
  slowEma: '10',
  smaPeriod: '10',
  fastMacd: '12',
  slowMacd: '26',
  signalMacd: '9',
};

export const STRATEGY_OPTIONS = ['Signal', 'Fast', 'Momentum', 'Flash 5st'] as const;
export const MARTINGALE_OPTIONS = [
  '122',
  '123',
  '124',
  '125',
  '126',
  '127',
  '128',
  '129',
  '130',
  '140',
  '150',
  '200',
  '250',
  '500',
  '1000',
];
export const MAX_MARTINGALE_OPTIONS = Array.from({ length: 11 }, (_, i) => String(i));
export const RESET_MARTINGALE_OPTIONS = ['-1', ...Array.from({ length: 11 }, (_, i) => String(i))];
export const STOP_LOSS_OPTIONS = Array.from({ length: 11 }, (_, i) => String(i));

export function normalizeTradeConfig(raw: Partial<TradeConfig> | null | undefined): TradeConfig {
  if (!raw) return { ...DEFAULT_TRADE_CONFIG };
  const rawStrategy = raw.strategy ? String(raw.strategy) : '';
  const strategy =
    rawStrategy === 'Analysis' ? 'Flash 5st' : (rawStrategy as TradeConfig['strategy']);
  const merged: TradeConfig = {
    ...DEFAULT_TRADE_CONFIG,
    ...raw,
    strategy: strategy ?? DEFAULT_TRADE_CONFIG.strategy,
    currency: raw.currency ? String(raw.currency).toUpperCase() : DEFAULT_TRADE_CONFIG.currency,
    bidAmountIdr: raw.bidAmountIdr ? String(raw.bidAmountIdr) : DEFAULT_TRADE_CONFIG.bidAmountIdr,
    bidAmountUsd: raw.bidAmountUsd ? String(raw.bidAmountUsd) : DEFAULT_TRADE_CONFIG.bidAmountUsd,
    bidAmountEur: raw.bidAmountEur ? String(raw.bidAmountEur) : DEFAULT_TRADE_CONFIG.bidAmountEur,
  };
  if (raw.bidAmount && !raw.bidAmountIdr && !raw.bidAmountUsd && !raw.bidAmountEur) {
    merged.bidAmountIdr = String(raw.bidAmount);
    merged.bidAmountUsd = String(raw.bidAmount);
    merged.bidAmountEur = String(raw.bidAmount);
  }
  return merged;
}
